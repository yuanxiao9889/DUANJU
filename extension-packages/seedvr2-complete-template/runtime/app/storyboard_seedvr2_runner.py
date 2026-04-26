#!/usr/bin/env python
from __future__ import annotations

import argparse
import gc
import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
from importlib import import_module
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
MODELS_DIR = RUNTIME_DIR / "models" / "SEEDVR2"
OUTPUTS_DIR = RUNTIME_DIR / "outputs"
CACHE_DIR = RUNTIME_DIR / "cache"
PYTHON_DIR = RUNTIME_DIR / "python"
BIN_DIR = RUNTIME_DIR / "bin"
VENDOR_DIR = RUNTIME_DIR / "vendor" / "ComfyUI-SeedVR2_VideoUpscaler"
CLI_FILE = VENDOR_DIR / "inference_cli.py"
FFMPEG_EXE = BIN_DIR / "ffmpeg.exe"
FFPROBE_EXE = BIN_DIR / "ffprobe.exe"
RUNNER_FILE = Path(__file__).resolve()
SERVER_RESPONSE_PREFIX = "__SC_EXTENSION_RESPONSE__:"

DEFAULT_DIT_MODEL = "seedvr2_ema_3b_fp8_e4m3fn.safetensors"
DEFAULT_VAE_MODEL = "ema_vae_fp16.safetensors"
IMAGE_PREPROCESS_SCALE = 0.6

IMAGE_RESOLUTIONS = {1080, 1440, 2160}
VIDEO_RESOLUTIONS = {720, 1080, 1440}

IMAGE_PRESET = {
    "batch_size": 1,
    "color_correction": "lab",
    "dit_offload_device": "cpu",
    "vae_offload_device": "cpu",
    "tensor_offload_device": "cpu",
}

VIDEO_PRESET = {
    "batch_size": 5,
    "uniform_batch_size": True,
    "temporal_overlap": 3,
    "prepend_frames": 2,
    "chunk_size": 45,
    "color_correction": "lab",
    "dit_offload_device": "cpu",
    "vae_offload_device": "cpu",
    "tensor_offload_device": "cpu",
    "video_backend": "ffmpeg",
}

MODULE_VERSIONS = (
    ("torch", "torch"),
    ("torchvision", "torchvision"),
    ("opencv-python", "cv2"),
    ("numpy", "numpy"),
    ("diffusers", "diffusers"),
    ("transformers", "transformers"),
    ("accelerate", "accelerate"),
    ("safetensors", "safetensors"),
)

os.environ.setdefault("HF_HOME", str(CACHE_DIR / "hf"))
os.environ.setdefault("TRANSFORMERS_CACHE", str(CACHE_DIR / "transformers"))
os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(CACHE_DIR / "hf"))
os.environ.setdefault("PYTHONWARNINGS", "ignore")

if str(VENDOR_DIR) not in sys.path:
    sys.path.insert(0, str(VENDOR_DIR))


def debug_log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def sanitize_name(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", str(value or "").strip())
    return cleaned.strip("-") or "output"


def ensure_runtime_dirs() -> None:
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def resolve_dist_version(distribution_name: str) -> str | None:
    try:
        return importlib_metadata.version(distribution_name)
    except importlib_metadata.PackageNotFoundError:
        return None


def is_module_available(module_name: str) -> bool:
    try:
        import_module(module_name)
        return True
    except Exception:
        return False


def resolve_python_executable() -> str:
    portable_python = PYTHON_DIR / "python.exe"
    if portable_python.exists():
        return str(portable_python)
    return sys.executable


def resolve_ffmpeg_executable() -> str:
    if FFMPEG_EXE.exists():
        return str(FFMPEG_EXE)
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg
    raise FileNotFoundError(f"Bundled ffmpeg is missing: {FFMPEG_EXE}")


def resolve_ffprobe_executable() -> str:
    if FFPROBE_EXE.exists():
        return str(FFPROBE_EXE)
    system_ffprobe = shutil.which("ffprobe")
    if system_ffprobe:
        return system_ffprobe
    raise FileNotFoundError(f"Bundled ffprobe is missing: {FFPROBE_EXE}")


def ensure_required_paths() -> Dict[str, bool]:
    checks = {
        "python": Path(resolve_python_executable()).exists(),
        "runner": RUNNER_FILE.exists(),
        "vendor": VENDOR_DIR.exists(),
        "cli": CLI_FILE.exists(),
        "modelsDir": MODELS_DIR.exists(),
        "ditModel": (MODELS_DIR / DEFAULT_DIT_MODEL).exists(),
        "vaeModel": (MODELS_DIR / DEFAULT_VAE_MODEL).exists(),
        "ffmpeg": FFMPEG_EXE.exists() or shutil.which("ffmpeg") is not None,
        "ffprobe": FFPROBE_EXE.exists() or shutil.which("ffprobe") is not None,
    }

    for _distribution_name, module_name in MODULE_VERSIONS:
        checks[module_name] = is_module_available(module_name)

    try:
        torch_module = import_module("torch")
        checks["cuda"] = bool(torch_module.cuda.is_available())
    except Exception:
        checks["cuda"] = False

    return checks


def clear_model_cache() -> None:
    gc.collect()

    try:
        torch_module = import_module("torch")
    except Exception:
        return

    if torch_module.cuda.is_available():
        try:
            torch_module.cuda.empty_cache()
        except Exception:
            pass


def normalize_text(value: Any, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"Missing required field: {label}")
    return normalized


def normalize_optional_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_int(value: Any, label: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(f"Invalid integer value for {label}") from None


def normalize_existing_file(value: Any, label: str) -> Path:
    candidate = Path(normalize_text(value, label)).expanduser()
    if not candidate.exists():
        raise FileNotFoundError(f"{label} does not exist: {candidate}")
    if not candidate.is_file():
        raise FileNotFoundError(f"{label} is not a file: {candidate}")
    return candidate.resolve()


def validate_resolution(value: Any, allowed: set[int], label: str) -> int:
    resolution = normalize_int(value, label)
    if resolution not in allowed:
        raise ValueError(
            f"Unsupported {label}: {resolution}. Allowed values: {sorted(allowed)}"
        )
    return resolution


def next_output_path(prefix: str, extension: str) -> Path:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    milliseconds = int((time.time() % 1) * 1000)
    return OUTPUTS_DIR / f"{sanitize_name(prefix)}-{timestamp}-{milliseconds:03d}.{extension}"


def preprocess_image_for_upscale(image_path: Path, output_prefix: str) -> tuple[Path, Dict[str, Any]]:
    try:
        from PIL import Image
    except Exception as error:
        raise RuntimeError("Pillow is required for SeedVR2 image preprocessing.") from error

    preprocessed_path = next_output_path(f"{output_prefix}-preprocess", "png")

    with Image.open(image_path) as image:
        input_width, input_height = image.size
        output_width = max(1, int(round(input_width * IMAGE_PREPROCESS_SCALE)))
        output_height = max(1, int(round(input_height * IMAGE_PREPROCESS_SCALE)))

        normalized_image = (
            image.convert("RGBA")
            if "A" in image.getbands() or image.mode in {"LA", "PA", "P"}
            else image.convert("RGB")
        )
        resampling = (
            Image.Resampling.LANCZOS
            if hasattr(Image, "Resampling")
            else Image.LANCZOS
        )
        resized_image = normalized_image.resize((output_width, output_height), resampling)
        resized_image.save(preprocessed_path, format="PNG")

    return preprocessed_path, {
        "preprocessScale": IMAGE_PREPROCESS_SCALE,
        "preprocessInputWidth": input_width,
        "preprocessInputHeight": input_height,
        "preprocessOutputWidth": output_width,
        "preprocessOutputHeight": output_height,
    }


def build_base_environment() -> Dict[str, str]:
    environment = dict(os.environ)
    python_path = environment.get("PYTHONPATH", "")
    vendor_path = str(VENDOR_DIR)
    environment["PYTHONPATH"] = (
        f"{vendor_path}{os.pathsep}{python_path}"
        if python_path
        else vendor_path
    )
    environment["HF_HOME"] = str(CACHE_DIR / "hf")
    environment["TRANSFORMERS_CACHE"] = str(CACHE_DIR / "transformers")
    environment["HUGGINGFACE_HUB_CACHE"] = str(CACHE_DIR / "hf")
    environment["PYTHONIOENCODING"] = "utf-8"
    environment["PYTHONUTF8"] = "1"
    environment["PATH"] = (
        f"{BIN_DIR}{os.pathsep}{environment['PATH']}"
        if environment.get("PATH")
        else str(BIN_DIR)
    )
    return environment


def parse_cli_error(stderr_text: str) -> str | None:
    normalized = stderr_text.lower()
    if "out of memory" in normalized or "cuda out of memory" in normalized:
        return "SeedVR2 GPU memory is insufficient for the selected resolution."
    if "input path not found" in normalized:
        return "The selected input file could not be found."
    if "ffmpeg requires ffmpeg in path" in normalized:
        return "Bundled ffmpeg is missing or unavailable."
    if "failed to download required models" in normalized:
        return "SeedVR2 model files are missing."
    return None


def run_seedvr2_cli(input_path: Path, output_path: Path, extra_args: list[str]) -> None:
    checks = ensure_required_paths()
    failed_checks = [name for name, passed in checks.items() if not passed]
    if failed_checks:
        if "cuda" in failed_checks:
            raise RuntimeError("SeedVR2 requires a CUDA-capable NVIDIA GPU.")
        if "ditModel" in failed_checks or "vaeModel" in failed_checks:
            raise FileNotFoundError("SeedVR2 model files are missing.")
        raise RuntimeError("SeedVR2 runtime checks failed: " + ", ".join(failed_checks))

    command = [
        resolve_python_executable(),
        str(CLI_FILE),
        str(input_path),
        "--output",
        str(output_path),
        "--model_dir",
        str(MODELS_DIR),
        "--dit_model",
        DEFAULT_DIT_MODEL,
    ]
    command.extend(extra_args)

    process = subprocess.run(
        command,
        cwd=str(VENDOR_DIR),
        env=build_base_environment(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )

    if process.returncode == 0:
        return

    stderr_text = (process.stderr or "").strip()
    stdout_text = (process.stdout or "").strip()
    parsed_error = parse_cli_error(stderr_text or stdout_text)
    if parsed_error:
        raise RuntimeError(parsed_error)

    combined = "\n".join(filter(None, [stderr_text, stdout_text])).strip()
    raise RuntimeError(
        combined.splitlines()[-1] if combined else "SeedVR2 inference failed."
    )


def probe_video_metadata(video_path: Path) -> Dict[str, Any]:
    ffprobe_command = [
        resolve_ffprobe_executable(),
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,duration",
        "-of",
        "json",
        str(video_path),
    ]

    process = subprocess.run(
        ffprobe_command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if process.returncode != 0:
        raise RuntimeError("Failed to probe the generated SeedVR2 video.")

    payload = json.loads(process.stdout or "{}")
    streams = payload.get("streams") or []
    stream = streams[0] if streams else {}
    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    duration = float(stream.get("duration") or 0.0)
    return {
        "width": width,
        "height": height,
        "duration": duration,
    }


def mux_original_audio(video_path: Path, source_video_path: Path) -> Path:
    muxed_path = video_path.with_name(f"{video_path.stem}-muxed{video_path.suffix}")
    ffmpeg_command = [
        resolve_ffmpeg_executable(),
        "-y",
        "-i",
        str(video_path),
        "-i",
        str(source_video_path),
        "-map",
        "0:v:0",
        "-map",
        "1:a?",
        "-c:v",
        "copy",
        "-c:a",
        "copy",
        str(muxed_path),
    ]

    process = subprocess.run(
        ffmpeg_command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if process.returncode != 0:
        raise RuntimeError("SeedVR2 finished, but video audio remux failed.")

    try:
        video_path.unlink(missing_ok=True)
    except Exception:
        pass

    return muxed_path


def command_health() -> Dict[str, Any]:
    checks = ensure_required_paths()
    return {
        "ok": all(checks.values()),
        "command": "health",
        "checks": checks,
        "versions": {
            distribution_name: resolve_dist_version(distribution_name)
            for distribution_name, _module_name in MODULE_VERSIONS
        },
        "device": "cuda" if checks.get("cuda") else "unavailable",
    }


def command_list_models() -> Dict[str, Any]:
    return {
        "ok": True,
        "command": "list_models",
        "models": [
            {
                "id": "seedvr2-default-dit",
                "path": str(MODELS_DIR / DEFAULT_DIT_MODEL),
                "exists": (MODELS_DIR / DEFAULT_DIT_MODEL).exists(),
            },
            {
                "id": "seedvr2-default-vae",
                "path": str(MODELS_DIR / DEFAULT_VAE_MODEL),
                "exists": (MODELS_DIR / DEFAULT_VAE_MODEL).exists(),
            },
        ],
    }


def command_warmup(_payload: Dict[str, Any]) -> Dict[str, Any]:
    started_at = time.time()
    checks = ensure_required_paths()
    failed_checks = [name for name, passed in checks.items() if not passed]
    if failed_checks:
        raise RuntimeError("SeedVR2 warmup checks failed: " + ", ".join(failed_checks))

    torch_module = import_module("torch")
    if not torch_module.cuda.is_available():
        raise RuntimeError("SeedVR2 requires a CUDA-capable NVIDIA GPU.")

    import_module("cv2")
    import_module("numpy")
    import_module("diffusers")
    import_module("transformers")
    import_module("accelerate")
    import_module("safetensors")

    elapsed_ms = int((time.time() - started_at) * 1000)
    return {
        "ok": True,
        "command": "warmup",
        "warmedModels": [
            {
                "model": DEFAULT_DIT_MODEL,
                "vae": DEFAULT_VAE_MODEL,
                "device": "cuda",
                "elapsedMs": elapsed_ms,
            }
        ],
    }


def command_upscale_image(payload: Dict[str, Any]) -> Dict[str, Any]:
    image_path = normalize_existing_file(payload.get("imagePath"), "imagePath")
    target_resolution = validate_resolution(
        payload.get("targetResolution"),
        IMAGE_RESOLUTIONS,
        "targetResolution",
    )
    output_prefix = normalize_optional_text(payload.get("outputPrefix")) or "seedvr2-image"
    preprocessed_image_path, preprocess_metadata = preprocess_image_for_upscale(
        image_path,
        output_prefix,
    )
    output_path = next_output_path(output_prefix, "png")

    cli_args = [
        "--resolution",
        str(target_resolution),
        "--output_format",
        "png",
        "--batch_size",
        str(IMAGE_PRESET["batch_size"]),
        "--color_correction",
        str(IMAGE_PRESET["color_correction"]),
        "--dit_offload_device",
        str(IMAGE_PRESET["dit_offload_device"]),
        "--vae_offload_device",
        str(IMAGE_PRESET["vae_offload_device"]),
        "--tensor_offload_device",
        str(IMAGE_PRESET["tensor_offload_device"]),
    ]

    if target_resolution >= 1440:
        cli_args.extend(["--vae_encode_tiled", "--vae_decode_tiled"])

    run_seedvr2_cli(preprocessed_image_path, output_path, cli_args)

    return {
        "ok": True,
        "command": "upscale_image",
        "output": {
            "path": str(output_path),
            "name": output_path.name,
            "mimeType": "image/png",
            "targetResolution": target_resolution,
            **preprocess_metadata,
        },
    }


def command_upscale_video(payload: Dict[str, Any]) -> Dict[str, Any]:
    video_path = normalize_existing_file(payload.get("videoPath"), "videoPath")
    target_resolution = validate_resolution(
        payload.get("targetResolution"),
        VIDEO_RESOLUTIONS,
        "targetResolution",
    )
    output_prefix = normalize_optional_text(payload.get("outputPrefix")) or "seedvr2-video"
    raw_output_path = next_output_path(output_prefix, "mp4")

    cli_args = [
        "--resolution",
        str(target_resolution),
        "--output_format",
        "mp4",
        "--batch_size",
        str(VIDEO_PRESET["batch_size"]),
        "--chunk_size",
        str(VIDEO_PRESET["chunk_size"]),
        "--temporal_overlap",
        str(VIDEO_PRESET["temporal_overlap"]),
        "--prepend_frames",
        str(VIDEO_PRESET["prepend_frames"]),
        "--color_correction",
        str(VIDEO_PRESET["color_correction"]),
        "--dit_offload_device",
        str(VIDEO_PRESET["dit_offload_device"]),
        "--vae_offload_device",
        str(VIDEO_PRESET["vae_offload_device"]),
        "--tensor_offload_device",
        str(VIDEO_PRESET["tensor_offload_device"]),
        "--video_backend",
        str(VIDEO_PRESET["video_backend"]),
    ]

    if VIDEO_PRESET["uniform_batch_size"]:
        cli_args.append("--uniform_batch_size")

    if target_resolution >= 1080:
        cli_args.extend(["--vae_encode_tiled", "--vae_decode_tiled"])

    run_seedvr2_cli(video_path, raw_output_path, cli_args)
    final_output_path = mux_original_audio(raw_output_path, video_path)
    metadata = probe_video_metadata(final_output_path)

    return {
        "ok": True,
        "command": "upscale_video",
        "output": {
            "path": str(final_output_path),
            "name": final_output_path.name,
            "mimeType": "video/mp4",
            "targetResolution": target_resolution,
            **metadata,
        },
    }


def dispatch_command(payload: Dict[str, Any]) -> Dict[str, Any]:
    command = normalize_optional_text(payload.get("command")) or "health"

    if command == "health":
        return command_health()
    if command == "list_models":
        return command_list_models()
    if command == "warmup":
        return command_warmup(payload)
    if command == "upscale_image":
        return command_upscale_image(payload)
    if command == "upscale_video":
        return command_upscale_video(payload)
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
            "error": traceback.format_exc().strip().splitlines()[-1]
            or "Unknown SeedVR2 runner error",
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
        raw_line = line.strip().lstrip("\ufeff")
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
