#!/usr/bin/env python
from __future__ import annotations

import argparse
import gc
import json
import os
import re
import sys
import time
import traceback
from importlib import metadata as importlib_metadata
from pathlib import Path
from typing import Any, Dict, Optional


def configure_stdio() -> None:
    stream_settings = (
        ("stdin", None),
        ("stdout", "backslashreplace"),
        ("stderr", "backslashreplace"),
    )

    for stream_name, errors in stream_settings:
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if not callable(reconfigure):
            continue

        kwargs = {"encoding": "utf-8"}
        if errors is not None:
            kwargs["errors"] = errors

        try:
            reconfigure(**kwargs)
        except Exception:
            continue


os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")
configure_stdio()

APP_DIR = Path(__file__).resolve().parent
RUNTIME_DIR = APP_DIR.parent
MODELS_DIR = RUNTIME_DIR / "models"
OUTPUTS_DIR = RUNTIME_DIR / "outputs"
CACHE_DIR = RUNTIME_DIR / "cache"
PYTHON_DIR = RUNTIME_DIR / "python"
MODEL_DIR = MODELS_DIR / "VoxCPM2"
SERVER_RESPONSE_PREFIX = "__SC_EXTENSION_RESPONSE__:"

os.environ.setdefault("HF_HOME", str(CACHE_DIR / "hf"))
os.environ.setdefault("MODELSCOPE_CACHE", str(CACHE_DIR / "modelscope"))
os.environ.setdefault("PYTHONWARNINGS", "ignore")

sys.path.insert(0, str(APP_DIR))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import torch  # noqa: E402
from voxcpm import VoxCPM  # noqa: E402

MODEL_CACHE: Dict[str, VoxCPM] = {}


def debug_log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def sanitize_name(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip())
    return cleaned.strip("-") or "output"


def ensure_runtime_dirs() -> None:
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def resolve_voxcpm_version() -> str | None:
    try:
        return importlib_metadata.version("voxcpm")
    except importlib_metadata.PackageNotFoundError:
        return None


def ensure_required_paths() -> Dict[str, bool]:
    return {
        "python": PYTHON_DIR.exists(),
        "model": MODEL_DIR.exists(),
        "runner": APP_DIR.exists(),
        "voxcpm": resolve_voxcpm_version() is not None,
    }


def clear_model_cache() -> None:
    MODEL_CACHE.clear()
    gc.collect()
    if torch.cuda.is_available():
        try:
            torch.cuda.empty_cache()
        except Exception:
            pass


def get_model(load_denoiser: bool = False) -> VoxCPM:
    cache_key = "voxcpm2|denoiser" if load_denoiser else "voxcpm2"
    if cache_key in MODEL_CACHE:
        return MODEL_CACHE[cache_key]

    if not MODEL_DIR.exists():
        raise FileNotFoundError(f"Model path does not exist: {MODEL_DIR}")

    model = VoxCPM.from_pretrained(str(MODEL_DIR), load_denoiser=load_denoiser)
    MODEL_CACHE[cache_key] = model
    return model


def next_output_path(prefix: str, extension: str) -> Path:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    return OUTPUTS_DIR / f"{sanitize_name(prefix)}-{timestamp}.{extension}"


def normalize_float(value: Any, fallback: float, min_value: float, max_value: float) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(min_value, min(max_value, numeric))


def normalize_int(value: Any, fallback: int, min_value: int, max_value: int) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(min_value, min(max_value, numeric))


def normalize_text(value: Any, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"Missing required field: {label}")
    return normalized


def normalize_optional_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_file_path(value: Any, label: str) -> str:
    normalized = normalize_text(value, label)
    if not Path(normalized).exists():
        raise FileNotFoundError(f"{label} does not exist: {normalized}")
    return normalized


def format_controlled_text(text: str, control: str) -> str:
    if not control:
        return text
    return f"({control}){text}"


def resolve_sample_rate(model: VoxCPM) -> int:
    for attribute in ("sample_rate", "sampling_rate"):
        value = getattr(model, attribute, None)
        if isinstance(value, int) and value > 0:
            return value
    tts_model = getattr(model, "tts_model", None)
    for attribute in ("sample_rate", "sampling_rate"):
        value = getattr(tts_model, attribute, None)
        if isinstance(value, int) and value > 0:
            return value
    return 48_000


def to_audio_array(value: Any) -> np.ndarray:
    if isinstance(value, torch.Tensor):
        array = value.detach().cpu().float().numpy()
    else:
        array = np.asarray(value, dtype=np.float32)

    if array.ndim == 0:
        raise ValueError("Generated audio is empty.")
    if array.ndim > 1:
        array = np.squeeze(array)
    if array.ndim != 1:
        raise ValueError("Generated audio must be a single waveform.")

    return array.astype(np.float32, copy=False)


def save_audio_output(audio: Any, sample_rate: int, prefix: str) -> Dict[str, Any]:
    waveform = to_audio_array(audio)
    output_path = next_output_path(prefix, "wav")
    sf.write(output_path, waveform, sample_rate)
    duration = float(len(waveform) / sample_rate) if sample_rate > 0 else 0.0

    return {
        "path": str(output_path),
        "name": output_path.name,
        "duration": duration,
        "mimeType": "audio/wav",
    }


def command_health() -> Dict[str, Any]:
    checks = ensure_required_paths()
    return {
        "ok": all(checks.values()),
        "command": "health",
        "checks": checks,
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "voxcpmVersion": resolve_voxcpm_version(),
    }


def command_list_models() -> Dict[str, Any]:
    return {
        "ok": True,
        "command": "list_models",
        "models": [
            {
                "id": "voxcpm2",
                "path": str(MODEL_DIR),
                "exists": MODEL_DIR.exists(),
            }
        ],
    }


def command_warmup(payload: Dict[str, Any]) -> Dict[str, Any]:
    load_denoiser = bool(payload.get("loadDenoiser", False))
    started_at = time.time()
    get_model(load_denoiser=load_denoiser)
    elapsed_ms = int((time.time() - started_at) * 1000)
    return {
        "ok": True,
        "command": "warmup",
        "warmedModels": [
            {
                "model": "voxcpm2",
                "device": "cuda" if torch.cuda.is_available() else "cpu",
                "elapsedMs": elapsed_ms,
            }
        ],
        "voxcpmVersion": resolve_voxcpm_version(),
    }


def command_generate_voice_design(payload: Dict[str, Any]) -> Dict[str, Any]:
    text = normalize_text(payload.get("text"), "text")
    control = normalize_optional_text(payload.get("voicePrompt") or payload.get("control"))
    model = get_model(load_denoiser=bool(payload.get("loadDenoiser", False)))
    output = model.generate(
        text=format_controlled_text(text, control),
        cfg_value=normalize_float(payload.get("cfgValue"), 1.3, 0.1, 5.0),
        inference_timesteps=normalize_int(payload.get("inferenceTimesteps"), 10, 1, 40),
    )
    sample_rate = resolve_sample_rate(model)
    output_record = save_audio_output(
        output,
        sample_rate,
        normalize_optional_text(payload.get("outputPrefix")) or "voice-design",
    )

    return {
        "ok": True,
        "command": "generate_voice_design",
        "outputs": [output_record],
    }


def command_generate_voice_clone(payload: Dict[str, Any]) -> Dict[str, Any]:
    text = normalize_text(payload.get("text"), "text")
    control = normalize_optional_text(payload.get("controlText") or payload.get("control"))
    reference_audio = normalize_file_path(
        payload.get("referenceAudio") or payload.get("reference_wav_path"),
        "referenceAudio",
    )
    model = get_model(load_denoiser=bool(payload.get("loadDenoiser", False)))
    output = model.generate(
        text=format_controlled_text(text, control),
        reference_wav_path=reference_audio,
        cfg_value=normalize_float(payload.get("cfgValue"), 1.3, 0.1, 5.0),
        inference_timesteps=normalize_int(payload.get("inferenceTimesteps"), 10, 1, 40),
    )
    sample_rate = resolve_sample_rate(model)
    output_record = save_audio_output(
        output,
        sample_rate,
        normalize_optional_text(payload.get("outputPrefix")) or "voice-clone",
    )

    return {
        "ok": True,
        "command": "generate_voice_clone",
        "outputs": [output_record],
    }


def command_generate_ultimate_clone(payload: Dict[str, Any]) -> Dict[str, Any]:
    text = normalize_text(payload.get("text"), "text")
    prompt_audio = normalize_file_path(
        payload.get("referenceAudio") or payload.get("prompt_wav_path"),
        "referenceAudio",
    )
    prompt_text = normalize_text(payload.get("promptText") or payload.get("prompt_text"), "promptText")
    use_reference_as_reference = payload.get("useReferenceAsReference", True) is not False
    reference_audio = (
        prompt_audio
        if use_reference_as_reference
        else normalize_optional_text(payload.get("referenceWavPath") or payload.get("reference_wav_path"))
    )

    model = get_model(load_denoiser=bool(payload.get("loadDenoiser", False)))
    generate_kwargs: Dict[str, Any] = {
        "text": text,
        "prompt_wav_path": prompt_audio,
        "prompt_text": prompt_text,
        "cfg_value": normalize_float(payload.get("cfgValue"), 1.3, 0.1, 5.0),
        "inference_timesteps": normalize_int(payload.get("inferenceTimesteps"), 10, 1, 40),
    }

    if reference_audio:
        generate_kwargs["reference_wav_path"] = reference_audio

    output = model.generate(**generate_kwargs)
    sample_rate = resolve_sample_rate(model)
    output_record = save_audio_output(
        output,
        sample_rate,
        normalize_optional_text(payload.get("outputPrefix")) or "ultimate-clone",
    )

    return {
        "ok": True,
        "command": "generate_ultimate_clone",
        "outputs": [output_record],
    }


def dispatch_command(payload: Dict[str, Any]) -> Dict[str, Any]:
    command = normalize_optional_text(payload.get("command")) or "health"

    if command == "health":
        return command_health()
    if command == "list_models":
        return command_list_models()
    if command == "warmup":
        return command_warmup(payload)
    if command == "generate_voice_design":
        return command_generate_voice_design(payload)
    if command == "generate_voice_clone":
        return command_generate_voice_clone(payload)
    if command == "generate_ultimate_clone":
        return command_generate_ultimate_clone(payload)
    if command == "shutdown":
        clear_model_cache()
        return {
            "ok": True,
            "command": "shutdown",
        }

    raise ValueError(f"Unsupported command: {command}")


def execute_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    command = normalize_optional_text(payload.get("command")) or "health"
    try:
        response = dispatch_command(payload)
        response.setdefault("ok", True)
        response.setdefault("command", command)
        return response
    except Exception:
        debug_log(traceback.format_exc())
        return {
            "ok": False,
            "command": command,
            "error": traceback.format_exc().strip().splitlines()[-1] or "Unknown VoxCPM runner error",
        }


def load_request_payload(args: argparse.Namespace) -> Dict[str, Any]:
    if args.request_file:
        with open(args.request_file, "r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise ValueError("request file must contain a JSON object")
        return payload

    if args.command:
        return {"command": args.command}

    return {"command": "health"}


def emit_server_response(response: Dict[str, Any]) -> None:
    print(
        f"{SERVER_RESPONSE_PREFIX}{json.dumps(response, ensure_ascii=False)}",
        flush=True,
    )


def run_server() -> int:
    for line in sys.stdin:
        raw_line = line.strip()
        if not raw_line:
            continue

        request_id: Optional[str] = None
        try:
            payload = json.loads(raw_line)
            if not isinstance(payload, dict):
                raise ValueError("server request must be a JSON object")

            raw_request_id = payload.get("requestId")
            request_id = str(raw_request_id) if raw_request_id is not None else None
            response = execute_payload(payload)
        except Exception:
            debug_log(traceback.format_exc())
            response = {
                "ok": False,
                "command": "unknown",
                "error": "Failed to process server request",
            }

        if request_id:
            response["requestId"] = request_id

        emit_server_response(response)

        if response.get("command") == "shutdown":
            return 0

    return 0


def main() -> int:
    ensure_runtime_dirs()

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--server",
        action="store_true",
        help="Run as a persistent JSON-line server over stdin/stdout.",
    )
    parser.add_argument(
        "--request-file",
        type=str,
        help="Path to a JSON request file. If omitted, a lightweight health check is returned.",
    )
    parser.add_argument(
        "--command",
        type=str,
        help="Shortcut command for simple requests like health or list_models.",
    )
    args = parser.parse_args()

    if args.server:
        return run_server()

    payload = load_request_payload(args)
    response = execute_payload(payload)
    print(json.dumps(response, ensure_ascii=False), flush=True)
    return 0 if response.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
