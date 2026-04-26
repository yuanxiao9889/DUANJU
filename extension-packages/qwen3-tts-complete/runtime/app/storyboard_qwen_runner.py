#!/usr/bin/env python
from __future__ import annotations

import argparse
import gc
import json
import os
import re
import shutil
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional


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

import numpy as np

APP_DIR = Path(__file__).resolve().parent
RUNTIME_DIR = APP_DIR.parent
PACKAGE_DIR = RUNTIME_DIR.parent
MODELS_DIR = RUNTIME_DIR / "models"
OUTPUTS_DIR = RUNTIME_DIR / "outputs"
VOICES_DIR = RUNTIME_DIR / "voices"
CACHE_DIR = RUNTIME_DIR / "cache"
PYTHON_DIR = RUNTIME_DIR / "python"
SOX_DIR = PYTHON_DIR / "Tools" / "sox"
QWEN_PACKAGE_DIR = APP_DIR / "qwen_tts"

os.environ.setdefault("PYTHONWARNINGS", "ignore")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")
os.environ.setdefault("HF_HOME", str(CACHE_DIR / "hf"))

if SOX_DIR.exists():
    os.environ["PATH"] = f"{SOX_DIR}{os.pathsep}{os.environ.get('PATH', '')}"

sys.path.insert(0, str(APP_DIR))

import soundfile as sf  # noqa: E402
import torch  # noqa: E402
from qwen_tts import Qwen3TTSModel, VoiceClonePromptItem  # noqa: E402

MODEL_PATHS = {
    "base": MODELS_DIR / "Qwen3-TTS-12Hz-1.7B-Base",
    "voice_design": MODELS_DIR / "Qwen3-TTS-12Hz-1.7B-VoiceDesign",
    "tokenizer": MODELS_DIR / "Qwen3-TTS-Tokenizer-12Hz",
}

MODEL_CACHE: Dict[str, Qwen3TTSModel] = {}
SERVER_RESPONSE_PREFIX = "__SC_EXTENSION_RESPONSE__:"


def debug_log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def sanitize_name(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip())
    return cleaned.strip("-") or "output"


def resolve_language(value: Optional[str]) -> str:
    normalized = (value or "auto").strip().lower()
    mapping = {
        "auto": "Auto",
        "zh": "Chinese",
        "cn": "Chinese",
        "chinese": "Chinese",
        "en": "English",
        "english": "English",
        "jp": "Japanese",
        "ja": "Japanese",
        "japanese": "Japanese",
        "kr": "Korean",
        "ko": "Korean",
        "korean": "Korean",
        "fr": "French",
        "french": "French",
        "de": "German",
        "german": "German",
        "es": "Spanish",
        "spanish": "Spanish",
        "pt": "Portuguese",
        "portuguese": "Portuguese",
        "ru": "Russian",
        "russian": "Russian",
        "it": "Italian",
        "italian": "Italian",
    }
    return mapping.get(normalized, value or "Auto")


def resolve_device(requested: Optional[str]) -> str:
    if requested and requested.strip():
        return requested.strip()
    return "cuda:0" if torch.cuda.is_available() else "cpu"


def resolve_dtype(requested: Optional[str], device: str) -> torch.dtype:
    normalized = (requested or "").strip().lower()
    if normalized in {"bf16", "bfloat16"}:
        return torch.bfloat16
    if normalized in {"fp16", "float16"}:
        return torch.float16
    if normalized in {"fp32", "float32"}:
        return torch.float32
    return torch.bfloat16 if device.startswith("cuda") else torch.float32


def ensure_runtime_dirs() -> None:
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def ensure_required_paths() -> Dict[str, bool]:
    return {
        "python": PYTHON_DIR.exists(),
        "qwen_tts": QWEN_PACKAGE_DIR.exists(),
        "base": MODEL_PATHS["base"].exists(),
        "voiceDesign": MODEL_PATHS["voice_design"].exists(),
        "tokenizer": MODEL_PATHS["tokenizer"].exists(),
        "sox": SOX_DIR.exists(),
    }


def clear_model_cache() -> None:
    MODEL_CACHE.clear()
    gc.collect()
    if torch.cuda.is_available():
        try:
            torch.cuda.empty_cache()
        except Exception:
            pass


def get_model(model_key: str, device: str, dtype_name: Optional[str]) -> Qwen3TTSModel:
    cache_key = f"{model_key}|{device}|{dtype_name or 'auto'}"
    if cache_key in MODEL_CACHE:
        return MODEL_CACHE[cache_key]

    model_path = MODEL_PATHS[model_key]
    if not model_path.exists():
        raise FileNotFoundError(f"Model path does not exist: {model_path}")

    dtype = resolve_dtype(dtype_name, device)
    attn_implementation = "flash_attention_2" if device.startswith("cuda") else None
    model = Qwen3TTSModel.from_pretrained(
        str(model_path),
        device_map=device,
        dtype=dtype,
        attn_implementation=attn_implementation,
    )
    MODEL_CACHE[cache_key] = model
    return model


def next_output_path(prefix: str, extension: str) -> Path:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    return OUTPUTS_DIR / f"{sanitize_name(prefix)}-{timestamp}.{extension}"


def next_voice_path(prefix: str) -> Path:
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    return VOICES_DIR / f"{sanitize_name(prefix)}.qvp"


def collect_generation_kwargs(payload: Dict[str, Any]) -> Dict[str, Any]:
    supported_keys = [
        "max_new_tokens",
        "temperature",
        "top_k",
        "top_p",
        "repetition_penalty",
        "subtalker_top_k",
        "subtalker_top_p",
        "subtalker_temperature",
    ]
    return {
        key: payload[key]
        for key in supported_keys
        if key in payload and payload[key] is not None
    }


def normalize_pause_value(value: Any, fallback: float) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(0.0, min(5.0, numeric))


def build_pause_config(payload: Dict[str, Any]) -> Dict[str, float]:
    return {
        "pause_linebreak": normalize_pause_value(
            payload.get("pause_linebreak", payload.get("pauseLinebreak")),
            0.5,
        ),
        "period_pause": normalize_pause_value(
            payload.get("period_pause", payload.get("periodPause")),
            0.4,
        ),
        "comma_pause": normalize_pause_value(
            payload.get("comma_pause", payload.get("commaPause")),
            0.2,
        ),
        "question_pause": normalize_pause_value(
            payload.get("question_pause", payload.get("questionPause")),
            0.6,
        ),
        "hyphen_pause": normalize_pause_value(
            payload.get("hyphen_pause", payload.get("hyphenPause")),
            0.3,
        ),
    }


def split_text_by_pauses(text: str, config: Dict[str, float]) -> List[tuple[str, float]]:
    if not config:
        return [(text, 0.0)]

    normalized_text = text.replace("\r\n", "\n").replace("\r", "\n")
    pause_linebreak = config.get("pause_linebreak", 0.5)
    period_pause = config.get("period_pause", 0.4)
    comma_pause = config.get("comma_pause", 0.2)
    question_pause = config.get("question_pause", 0.6)
    hyphen_pause = config.get("hyphen_pause", 0.3)

    if pause_linebreak > 0:
        normalized_text = re.sub(r"\n+", rf" [break={pause_linebreak}] ", normalized_text)
    else:
        normalized_text = normalized_text.replace("\n", " ")

    if period_pause > 0:
        normalized_text = re.sub(
            r"[\.\u3002](?!\d)",
            rf"\g<0> [break={period_pause}]",
            normalized_text,
        )
    if comma_pause > 0:
        normalized_text = re.sub(
            r"[,\uff0c](?!\d)",
            rf"\g<0> [break={comma_pause}]",
            normalized_text,
        )
    if question_pause > 0:
        normalized_text = re.sub(
            r"[\?\uff1f](?!\d)",
            rf"\g<0> [break={question_pause}]",
            normalized_text,
        )
    if hyphen_pause > 0:
        normalized_text = re.sub(
            r"[-\u2014](?!\d)",
            rf"\g<0> [break={hyphen_pause}]",
            normalized_text,
        )

    pause_pattern = r"\[break=([\d\.]+)\]"
    parts = re.split(pause_pattern, normalized_text)
    segments: List[tuple[str, float]] = []
    current_segment_text = ""

    for index, chunk in enumerate(parts):
        if index % 2 == 0:
            if chunk.strip():
                if current_segment_text:
                    segments.append((current_segment_text.strip(), 0.0))
                current_segment_text = chunk
        else:
            try:
                pause_val = float(chunk)
            except ValueError:
                pause_val = 0.0

            if current_segment_text:
                segments.append((current_segment_text.strip(), pause_val))
                current_segment_text = ""
            elif segments and pause_val > 0:
                previous_text, previous_pause = segments[-1]
                segments[-1] = (previous_text, previous_pause + pause_val)

    if current_segment_text.strip():
        segments.append((current_segment_text.strip(), 0.0))

    return segments or [(normalized_text.strip(), 0.0)]

def normalize_waveform(wav: Any) -> np.ndarray:
    waveform = np.asarray(wav, dtype=np.float32)
    waveform = np.squeeze(waveform)
    if waveform.ndim > 1:
        waveform = np.mean(waveform, axis=0, dtype=np.float32)
    return waveform.astype(np.float32)


def build_silence(sample_rate: int, duration: float) -> np.ndarray:
    silence_len = max(0, int(duration * sample_rate))
    return np.zeros((silence_len,), dtype=np.float32)


def clean_segment_text(text: str) -> str:
    cleaned = re.sub(r"[\.,\uff0c\u3002\u2026\-\u2014]+$", "", text).strip()
    return cleaned or text.strip()

def save_voice_metadata(
    metadata_path: Path,
    voice_name: str,
    ref_text: Optional[str],
    ref_audio: Optional[str],
) -> None:
    metadata = {
        "voiceName": voice_name,
        "refText": (ref_text or "").strip(),
        "refAudio": ref_audio or "",
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "source": "Storyboard Copilot",
        "version": "1.0",
    }
    with open(metadata_path, "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, ensure_ascii=False, indent=2)


def load_voice_prompt_file(prompt_file: str) -> List[VoiceClonePromptItem]:
    try:
        voice_prompt = torch.load(prompt_file, map_location="cpu", weights_only=False)
    except TypeError:
        voice_prompt = torch.load(prompt_file, map_location="cpu")

    raw_items = voice_prompt.get("items") if isinstance(voice_prompt, dict) else voice_prompt
    if not isinstance(raw_items, list):
        raise ValueError("Prompt file does not contain valid prompt items")

    prompt_items: List[VoiceClonePromptItem] = []
    for item in raw_items:
        if isinstance(item, VoiceClonePromptItem):
            prompt_items.append(item)
            continue

        if not isinstance(item, dict):
            raise ValueError("Prompt item is not a valid dictionary")

        prompt_items.append(
            VoiceClonePromptItem(
                ref_code=item["ref_code"],
                ref_spk_embedding=item["ref_spk_embedding"],
                x_vector_only_mode=bool(item.get("x_vector_only_mode", False)),
                icl_mode=bool(item.get("icl_mode", False)),
                ref_text=item.get("ref_text"),
            )
        )

    return prompt_items


def generate_segmented_voice_design(
    model: Qwen3TTSModel,
    text: str,
    language: str,
    instruct: str,
    generation_kwargs: Dict[str, Any],
    pause_config: Dict[str, float],
) -> tuple[List[np.ndarray], int]:
    segments = split_text_by_pauses(text, pause_config)
    results: List[np.ndarray] = []
    sample_rate = 24000

    for segment_text, pause_duration in segments:
        pronounceable = re.sub(r"[^\w\u4e00-\u9fff]", "", segment_text)
        if pronounceable.strip():
            wavs, sample_rate = model.generate_voice_design(
                text=clean_segment_text(segment_text),
                language=language,
                instruct=instruct,
                **generation_kwargs,
            )
            for wav in wavs:
                results.append(normalize_waveform(wav))

        if pause_duration > 0:
            results.append(build_silence(sample_rate, pause_duration))

    if not results:
        raise ValueError("No audio was generated from the provided text")

    return [np.concatenate(results)], sample_rate


def generate_segmented_voice_clone(
    model: Qwen3TTSModel,
    text: str,
    language: str,
    generation_kwargs: Dict[str, Any],
    pause_config: Dict[str, float],
) -> tuple[List[np.ndarray], int]:
    segments = split_text_by_pauses(text, pause_config)
    results: List[np.ndarray] = []
    sample_rate = 24000

    for segment_text, pause_duration in segments:
        pronounceable = re.sub(r"[^\w\u4e00-\u9fff]", "", segment_text)
        if pronounceable.strip():
            wavs, sample_rate = model.generate_voice_clone(
                text=clean_segment_text(segment_text),
                language=language,
                **generation_kwargs,
            )
            for wav in wavs:
                results.append(normalize_waveform(wav))

        if pause_duration > 0:
            results.append(build_silence(sample_rate, pause_duration))

    if not results:
        raise ValueError("No audio was generated from the provided text")

    return [np.concatenate(results)], sample_rate


def resolve_output_format(value: Any) -> str:
    normalized = str(value or "wav").strip().lower()
    return normalized if normalized in {"wav", "mp3"} else "wav"


def save_audio_outputs(
    prefix: str,
    wavs: List[Any],
    sample_rate: int,
    output_format: str = "wav",
) -> List[Dict[str, Any]]:
    normalized_output_format = resolve_output_format(output_format)
    saved_files: List[Dict[str, Any]] = []
    for index, wav in enumerate(wavs):
        suffix = f"{prefix}-{index + 1}" if len(wavs) > 1 else prefix
        output_path = next_output_path(suffix, normalized_output_format)
        if normalized_output_format == "mp3":
            sf.write(
                str(output_path),
                wav,
                sample_rate,
                format="MP3",
                subtype="MPEG_LAYER_III",
            )
            mime_type = "audio/mpeg"
        else:
            sf.write(str(output_path), wav, sample_rate)
            mime_type = "audio/wav"
        duration = float(len(wav) / sample_rate) if sample_rate > 0 else 0.0
        saved_files.append(
            {
                "path": str(output_path),
                "name": output_path.name,
                "duration": duration,
                "mimeType": mime_type,
            }
        )
    return saved_files


def command_health() -> Dict[str, Any]:
    ensure_runtime_dirs()
    checks = ensure_required_paths()
    return {
      "ok": all(checks.values()),
      "command": "health",
      "checks": checks,
      "pythonExecutable": sys.executable,
      "cudaAvailable": torch.cuda.is_available(),
      "deviceCount": torch.cuda.device_count() if torch.cuda.is_available() else 0,
    }


def command_list_models() -> Dict[str, Any]:
    return {
        "ok": True,
        "command": "list_models",
        "models": [
            {
                "id": "voice_design",
                "path": str(MODEL_PATHS["voice_design"]),
                "exists": MODEL_PATHS["voice_design"].exists(),
            },
            {
                "id": "base",
                "path": str(MODEL_PATHS["base"]),
                "exists": MODEL_PATHS["base"].exists(),
            },
            {
                "id": "tokenizer",
                "path": str(MODEL_PATHS["tokenizer"]),
                "exists": MODEL_PATHS["tokenizer"].exists(),
            },
        ],
    }


def command_shutdown() -> Dict[str, Any]:
    clear_model_cache()
    return {
        "ok": True,
        "command": "shutdown",
    }


def command_warmup(payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_runtime_dirs()
    requested_models = payload.get("models")
    if isinstance(requested_models, list):
        model_keys = [
            str(model_key).strip()
            for model_key in requested_models
            if str(model_key).strip() in MODEL_PATHS
        ]
    else:
        model_keys = ["voice_design", "base"]

    if not model_keys:
        model_keys = ["voice_design", "base"]

    device = resolve_device(payload.get("device"))
    dtype_name = payload.get("dtype")
    warmed_models: List[Dict[str, Any]] = []

    for model_key in model_keys:
        started_at = time.time()
        model = get_model(model_key, device, dtype_name)
        warmed_models.append(
            {
                "model": model_key,
                "device": str(model.device),
                "elapsedMs": int((time.time() - started_at) * 1000),
            }
        )

    return {
        "ok": True,
        "command": "warmup",
        "warmedModels": warmed_models,
        "cachedModels": sorted(MODEL_CACHE.keys()),
    }


def command_generate_voice_design(payload: Dict[str, Any]) -> Dict[str, Any]:
    debug_log(
        "[qwen-runner] generate_voice_design payload "
        f"text_type={type(payload.get('text')).__name__} "
        f"voicePrompt_type={type(payload.get('voicePrompt')).__name__} "
        f"language_type={type(payload.get('language')).__name__} "
        f"text_preview={repr(str(payload.get('text', ''))[:120])} "
        f"voicePrompt_preview={repr(str(payload.get('voicePrompt', ''))[:160])}"
    )
    text = (payload.get("text") or "").strip()
    instruct = (payload.get("instruct") or payload.get("voicePrompt") or "").strip()
    if not text:
        raise ValueError("text is required")
    if not instruct:
        raise ValueError("instruct is required for voice design")

    device = resolve_device(payload.get("device"))
    model = get_model("voice_design", device, payload.get("dtype"))
    wavs, sample_rate = generate_segmented_voice_design(
        model=model,
        text=text,
        language=resolve_language(payload.get("language")),
        instruct=instruct,
        generation_kwargs=collect_generation_kwargs(payload),
        pause_config=build_pause_config(payload),
    )
    files = save_audio_outputs(
        payload.get("outputPrefix") or "voice-design",
        wavs,
        sample_rate,
        payload.get("outputFormat") or "wav",
    )
    return {
        "ok": True,
        "command": "generate_voice_design",
        "files": [item["path"] for item in files],
        "outputs": files,
        "sampleRate": sample_rate,
    }


def command_create_voice_clone_prompt(payload: Dict[str, Any]) -> Dict[str, Any]:
    ref_audio = payload.get("refAudio")
    ref_text = payload.get("refText")
    x_vector_only_mode = bool(payload.get("xVectorOnlyMode", False))
    if not ref_audio:
        raise ValueError("refAudio is required")

    device = resolve_device(payload.get("device"))
    model = get_model("base", device, payload.get("dtype"))
    prompt_items = model.create_voice_clone_prompt(
        ref_audio=ref_audio,
        ref_text=ref_text,
        x_vector_only_mode=x_vector_only_mode,
    )
    voice_name = payload.get("voiceName") or payload.get("outputPrefix") or "voice-prompt"
    output_path = next_voice_path(voice_name)
    payload_to_save = {
        "items": [item.__dict__ for item in prompt_items],
        "voiceName": voice_name,
        "refText": (ref_text or "").strip() if isinstance(ref_text, str) else "",
    }
    torch.save(payload_to_save, str(output_path))
    metadata_path = output_path.with_suffix(".json")
    save_voice_metadata(metadata_path, str(voice_name), ref_text, ref_audio)
    ref_audio_path = Path(str(ref_audio))
    if ref_audio_path.exists() and ref_audio_path.is_file():
        try:
            shutil.copy2(
                ref_audio_path,
                output_path.with_suffix(ref_audio_path.suffix or ".wav"),
            )
        except OSError:
            pass
    return {
        "ok": True,
        "command": "create_voice_clone_prompt",
        "promptFile": str(output_path),
        "promptLabel": output_path.name,
    }


def command_generate_voice_clone(payload: Dict[str, Any]) -> Dict[str, Any]:
    text = payload.get("text")
    if isinstance(text, str):
        text = text.strip()
    if not text:
        raise ValueError("text is required")

    device = resolve_device(payload.get("device"))
    model = get_model("base", device, payload.get("dtype"))

    generate_kwargs = dict(
        **collect_generation_kwargs(payload),
    )

    prompt_file = payload.get("promptFile")
    if prompt_file:
        generate_kwargs["voice_clone_prompt"] = load_voice_prompt_file(str(prompt_file))
    else:
        ref_audio = payload.get("refAudio")
        if not ref_audio:
            raise ValueError("refAudio is required when promptFile is not provided")
        generate_kwargs["ref_audio"] = ref_audio
        generate_kwargs["ref_text"] = payload.get("refText")
        generate_kwargs["x_vector_only_mode"] = bool(
            payload.get("xVectorOnlyMode", False)
        )

    wavs, sample_rate = generate_segmented_voice_clone(
        model=model,
        text=text,
        language=resolve_language(payload.get("language")),
        generation_kwargs=generate_kwargs,
        pause_config=build_pause_config(payload),
    )
    files = save_audio_outputs(
        payload.get("outputPrefix") or "voice-clone",
        wavs,
        sample_rate,
        payload.get("outputFormat") or "wav",
    )
    return {
        "ok": True,
        "command": "generate_voice_clone",
        "files": [item["path"] for item in files],
        "outputs": files,
        "sampleRate": sample_rate,
    }


def dispatch(payload: Dict[str, Any]) -> Dict[str, Any]:
    command = (payload.get("command") or "").strip()
    if not command:
        raise ValueError("command is required")

    if command == "health":
        return command_health()
    if command == "list_models":
        return command_list_models()
    if command == "warmup":
        return command_warmup(payload)
    if command == "shutdown":
        return command_shutdown()
    if command == "generate_voice_design":
        return command_generate_voice_design(payload)
    if command == "create_voice_clone_prompt":
        return command_create_voice_clone_prompt(payload)
    if command == "generate_voice_clone":
        return command_generate_voice_clone(payload)

    raise ValueError(f"Unsupported command: {command}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Storyboard Copilot bridge runner for the offline Qwen3 TTS runtime."
    )
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
    return parser.parse_args()


def load_payload(args: argparse.Namespace) -> Dict[str, Any]:
    if args.request_file:
        with open(args.request_file, "r", encoding="utf-8-sig") as handle:
            return json.load(handle)

    if args.command:
        return {"command": args.command}

    return {"command": "health"}


def emit_server_response(response: Dict[str, Any]) -> None:
    print(
        f"{SERVER_RESPONSE_PREFIX}{json.dumps(response, ensure_ascii=False)}",
        flush=True,
    )


def run_server() -> int:
    ensure_runtime_dirs()

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        payload: Dict[str, Any] = {}
        request_id: Optional[str] = None

        try:
            decoded = json.loads(line)
            if not isinstance(decoded, dict):
                raise ValueError("server request must be a JSON object")

            payload = decoded
            raw_request_id = payload.get("requestId")
            request_id = str(raw_request_id) if raw_request_id is not None else None
            response = dispatch(payload)
        except Exception as error:  # noqa: BLE001
            traceback.print_exc(file=sys.stderr)
            response = {
                "ok": False,
                "command": payload.get("command"),
                "error": f"{type(error).__name__}: {error}",
            }

        if request_id:
            response["requestId"] = request_id

        emit_server_response(response)

        if response.get("ok") and response.get("command") == "shutdown":
            break

    clear_model_cache()
    return 0


def main() -> int:
    ensure_runtime_dirs()
    args = parse_args()
    if args.server:
        return run_server()

    payload = load_payload(args)

    try:
        response = dispatch(payload)
    except Exception as error:  # noqa: BLE001
        traceback.print_exc(file=sys.stderr)
        response = {
            "ok": False,
            "command": payload.get("command"),
            "error": f"{type(error).__name__}: {error}",
        }

    print(json.dumps(response, ensure_ascii=False))
    return 0 if response.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())

