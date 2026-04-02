#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

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
    "custom_voice": MODELS_DIR / "Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "tokenizer": MODELS_DIR / "Qwen3-TTS-Tokenizer-12Hz",
}

MODEL_CACHE: Dict[str, Qwen3TTSModel] = {}


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
        "customVoice": MODEL_PATHS["custom_voice"].exists(),
        "tokenizer": MODEL_PATHS["tokenizer"].exists(),
        "sox": SOX_DIR.exists(),
    }


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
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    return VOICES_DIR / f"{sanitize_name(prefix)}-{timestamp}.pt"


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


def save_wavs(prefix: str, wavs: List[Any], sample_rate: int) -> List[Dict[str, Any]]:
    saved_files: List[Dict[str, Any]] = []
    for index, wav in enumerate(wavs):
        suffix = f"{prefix}-{index + 1}" if len(wavs) > 1 else prefix
        output_path = next_output_path(suffix, "wav")
        sf.write(str(output_path), wav, sample_rate)
        duration = float(len(wav) / sample_rate) if sample_rate > 0 else 0.0
        saved_files.append(
            {
                "path": str(output_path),
                "name": output_path.name,
                "duration": duration,
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
                "id": "custom_voice",
                "path": str(MODEL_PATHS["custom_voice"]),
                "exists": MODEL_PATHS["custom_voice"].exists(),
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


def command_generate_voice_design(payload: Dict[str, Any]) -> Dict[str, Any]:
    text = (payload.get("text") or "").strip()
    instruct = (payload.get("instruct") or payload.get("voicePrompt") or "").strip()
    if not text:
        raise ValueError("text is required")
    if not instruct:
        raise ValueError("instruct is required for voice design")

    device = resolve_device(payload.get("device"))
    model = get_model("voice_design", device, payload.get("dtype"))
    wavs, sample_rate = model.generate_voice_design(
        text=text,
        language=resolve_language(payload.get("language")),
        instruct=instruct,
        **collect_generation_kwargs(payload),
    )
    files = save_wavs(payload.get("outputPrefix") or "voice-design", wavs, sample_rate)
    return {
        "ok": True,
        "command": "generate_voice_design",
        "files": [item["path"] for item in files],
        "outputs": files,
        "sampleRate": sample_rate,
    }


def command_generate_custom_voice(payload: Dict[str, Any]) -> Dict[str, Any]:
    text = (payload.get("text") or "").strip()
    speaker = (payload.get("speaker") or "").strip()
    if not text:
        raise ValueError("text is required")
    if not speaker:
        raise ValueError("speaker is required")

    device = resolve_device(payload.get("device"))
    model = get_model("custom_voice", device, payload.get("dtype"))
    wavs, sample_rate = model.generate_custom_voice(
        text=text,
        language=resolve_language(payload.get("language")),
        speaker=speaker,
        instruct=(payload.get("instruct") or "").strip() or None,
        **collect_generation_kwargs(payload),
    )
    files = save_wavs(payload.get("outputPrefix") or "custom-voice", wavs, sample_rate)
    return {
        "ok": True,
        "command": "generate_custom_voice",
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
    output_path = next_voice_path(payload.get("outputPrefix") or "voice-prompt")
    payload_to_save = {
        "items": [item.__dict__ for item in prompt_items],
    }
    torch.save(payload_to_save, str(output_path))
    return {
        "ok": True,
        "command": "create_voice_clone_prompt",
        "promptFile": str(output_path),
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
        text=text,
        language=resolve_language(payload.get("language")),
        **collect_generation_kwargs(payload),
    )

    prompt_file = payload.get("promptFile")
    if prompt_file:
        voice_prompt = torch.load(prompt_file, map_location="cpu", weights_only=True)
        generate_kwargs["voice_clone_prompt"] = [
            VoiceClonePromptItem(
                ref_code=item["ref_code"],
                ref_spk_embedding=item["ref_spk_embedding"],
                x_vector_only_mode=bool(item["x_vector_only_mode"]),
                icl_mode=bool(item["icl_mode"]),
                ref_text=item.get("ref_text"),
            )
            for item in voice_prompt["items"]
        ]
    else:
        ref_audio = payload.get("refAudio")
        if not ref_audio:
            raise ValueError("refAudio is required when promptFile is not provided")
        generate_kwargs["ref_audio"] = ref_audio
        generate_kwargs["ref_text"] = payload.get("refText")
        generate_kwargs["x_vector_only_mode"] = bool(
            payload.get("xVectorOnlyMode", False)
        )

    wavs, sample_rate = model.generate_voice_clone(**generate_kwargs)
    files = save_wavs(payload.get("outputPrefix") or "voice-clone", wavs, sample_rate)
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
    if command == "generate_voice_design":
        return command_generate_voice_design(payload)
    if command == "generate_custom_voice":
        return command_generate_custom_voice(payload)
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


def main() -> int:
    ensure_runtime_dirs()
    args = parse_args()
    payload = load_payload(args)

    try:
        response = dispatch(payload)
    except Exception as error:  # noqa: BLE001
        response = {
            "ok": False,
            "command": payload.get("command"),
            "error": f"{type(error).__name__}: {error}",
        }

    print(json.dumps(response, ensure_ascii=False))
    return 0 if response.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
