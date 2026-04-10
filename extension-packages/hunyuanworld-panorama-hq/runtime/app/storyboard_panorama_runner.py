#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional

SERVER_RESPONSE_PREFIX = "__SC_EXTENSION_RESPONSE__:"
APP_DIR = Path(__file__).resolve().parent
RUNTIME_DIR = APP_DIR.parent
OUTPUTS_DIR = RUNTIME_DIR / "outputs"
CACHE_DIR = RUNTIME_DIR / "cache"
HF_HOME_DIR = CACHE_DIR / "hf"
DEFAULT_SCRIPT_NAME = "demo_panogen.py"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


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
os.environ.setdefault("HF_HOME", str(HF_HOME_DIR))
configure_stdio()


def debug_log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def ensure_output_dir() -> None:
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    HF_HOME_DIR.mkdir(parents=True, exist_ok=True)


def sanitize_name(value: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in "._-" else "-" for char in value.strip())
    cleaned = cleaned.strip("-")
    return cleaned or "output"


def env_path(name: str) -> Optional[Path]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    return Path(raw).expanduser()


def resolve_repo_root() -> Optional[Path]:
    env_repo = env_path("HUNYUANWORLD_REPO")
    if env_repo:
        return env_repo

    bundled_repo = RUNTIME_DIR / "vendor" / "HunyuanWorld-1.0"
    if bundled_repo.exists():
        return bundled_repo

    return None


def resolve_script_path(repo_root: Optional[Path]) -> Optional[Path]:
    raw_script = os.environ.get("HUNYUANWORLD_SCRIPT", "").strip()
    if raw_script:
        candidate = Path(raw_script).expanduser()
        if candidate.is_absolute():
            return candidate
        if repo_root:
            return repo_root / candidate
        return candidate

    if repo_root:
        return repo_root / DEFAULT_SCRIPT_NAME

    return None


def import_image_stack() -> tuple[Any, Any]:
    try:
        import numpy as np  # type: ignore
    except Exception as error:
        raise RuntimeError(f"NumPy is required: {error}") from error

    try:
        from PIL import Image  # type: ignore
    except Exception as error:
        raise RuntimeError(f"Pillow is required: {error}") from error

    return np, Image


def collect_health_checks() -> Dict[str, bool]:
    repo_root = resolve_repo_root()
    script_path = resolve_script_path(repo_root)
    checks = {
        "repo": bool(repo_root and repo_root.exists()),
        "script": bool(script_path and script_path.exists()),
        "outputsDir": True,
    }

    try:
        import_image_stack()
        checks["numpy"] = True
        checks["pillow"] = True
    except Exception:
        checks["numpy"] = False
        checks["pillow"] = False

    return checks


def command_health() -> Dict[str, Any]:
    ensure_output_dir()
    repo_root = resolve_repo_root()
    script_path = resolve_script_path(repo_root)
    checks = collect_health_checks()
    return {
        "ok": checks["repo"] and checks["script"],
        "command": "health",
        "checks": checks,
        "pythonExecutable": sys.executable,
        "repoRoot": str(repo_root) if repo_root else None,
        "scriptPath": str(script_path) if script_path else None,
        "outputsDir": str(OUTPUTS_DIR),
        "hfHome": str(HF_HOME_DIR),
    }


def command_list_models() -> Dict[str, Any]:
    repo_root = resolve_repo_root()
    script_path = resolve_script_path(repo_root)
    return {
        "ok": True,
        "command": "list_models",
        "models": [
            {
                "id": "hunyuanworld-panogen",
                "path": str(script_path) if script_path else "",
                "exists": bool(script_path and script_path.exists()),
                "repoRoot": str(repo_root) if repo_root else "",
            }
        ],
    }


def newest_image_file(root: Path) -> Optional[Path]:
    if not root.exists():
        return None

    preferred: List[Path] = []
    fallback: List[Path] = []
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        if "panorama" in path.stem.lower() or "pano" in path.stem.lower():
            preferred.append(path)
        else:
            fallback.append(path)

    candidates = preferred or fallback
    if not candidates:
        return None

    return max(candidates, key=lambda item: item.stat().st_mtime)


def image_metadata(image_path: Path) -> Dict[str, Any]:
    np, Image = import_image_stack()
    del np
    with Image.open(image_path) as image:
        width, height = image.size

    gcd = math.gcd(max(1, width), max(1, height))
    aspect_ratio = f"{max(1, width) // gcd}:{max(1, height) // gcd}"
    return {
        "width": width,
        "height": height,
        "aspectRatio": aspect_ratio,
    }


def build_panogen_command(
    script_path: Path,
    image_path: Path,
    output_dir: Path,
    prompt: str,
    use_cache: bool,
    use_fp8_attention: bool,
    use_fp8_gemm: bool,
) -> List[str]:
    command = [
        sys.executable,
        str(script_path),
        "--image_path",
        str(image_path),
        "--output_path",
        str(output_dir),
    ]

    if prompt:
        command.extend(["--prompt", prompt])

    if use_cache:
        command.append("--cache")
    if use_fp8_attention:
        command.append("--fp8_attention")
    if use_fp8_gemm:
        command.append("--fp8_gemm")

    return command


def summarize_subprocess_output(output: str) -> str:
    stripped = output.strip()
    if not stripped:
        return ""
    lines = stripped.splitlines()
    return "\n".join(lines[-18:])


def command_generate_panorama(payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_output_dir()
    repo_root = resolve_repo_root()
    script_path = resolve_script_path(repo_root)

    if not repo_root or not repo_root.exists():
        raise FileNotFoundError(
            "HUNYUANWORLD_REPO is not configured or the directory does not exist."
        )
    if not script_path or not script_path.exists():
        raise FileNotFoundError(
            "Could not find the panorama script. Set HUNYUANWORLD_SCRIPT if your entry file is not demo_panogen.py."
        )

    image_path = Path(str(payload.get("imagePath", "")).strip())
    if not image_path.exists():
        raise FileNotFoundError(f"Input image does not exist: {image_path}")

    prompt = str(payload.get("prompt", "")).strip()
    output_resolution = str(payload.get("outputResolution", "4096x2048")).strip() or "4096x2048"
    scene_class = str(payload.get("sceneClass", "auto")).strip().lower() or "auto"
    use_cache = bool(payload.get("useCache", True))
    use_fp8_attention = bool(payload.get("useFp8Attention", True))
    use_fp8_gemm = bool(payload.get("useFp8Gemm", True))
    output_prefix = sanitize_name(str(payload.get("outputPrefix", "panorama")).strip() or "panorama")
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    output_dir = OUTPUTS_DIR / f"{output_prefix}-{timestamp}"
    output_dir.mkdir(parents=True, exist_ok=True)

    command = build_panogen_command(
        script_path=script_path,
        image_path=image_path,
        output_dir=output_dir,
        prompt=prompt,
        use_cache=use_cache,
        use_fp8_attention=use_fp8_attention,
        use_fp8_gemm=use_fp8_gemm,
    )
    debug_log(f"[panorama-runner] exec: {' '.join(command)}")
    process_env = os.environ.copy()
    process_env["SC_PANORAMA_OUTPUT_RESOLUTION"] = output_resolution
    process_env["SC_PANORAMA_SCENE_CLASS"] = scene_class

    completed = subprocess.run(
        command,
        cwd=str(repo_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=process_env,
    )
    if completed.returncode != 0:
        stderr_summary = summarize_subprocess_output(completed.stderr)
        stdout_summary = summarize_subprocess_output(completed.stdout)
        raise RuntimeError(
            "HunyuanWorld panorama generation failed.\n"
            f"stdout:\n{stdout_summary or '(empty)'}\n"
            f"stderr:\n{stderr_summary or '(empty)'}"
        )

    output_image = newest_image_file(output_dir)
    if not output_image:
        raise FileNotFoundError(
            f"The panorama script completed but no output image was found in {output_dir}."
        )

    metadata = image_metadata(output_image)
    return {
        "ok": True,
        "command": "generate_panorama",
        "outputs": [
            {
                "path": str(output_image),
                "name": output_image.name,
                **metadata,
            }
        ],
        "outputDir": str(output_dir),
    }


def bilinear_sample(np: Any, source: Any, x: Any, y: Any) -> Any:
    width = source.shape[1]
    height = source.shape[0]

    x_floor = np.floor(x)
    y_floor = np.floor(y)
    x0 = x_floor.astype(np.int32) % width
    y0 = np.clip(y_floor.astype(np.int32), 0, height - 1)
    x1 = (x0 + 1) % width
    y1 = np.clip(y0 + 1, 0, height - 1)

    dx = x - x_floor
    dy = y - y_floor
    wa = (1.0 - dx) * (1.0 - dy)
    wb = dx * (1.0 - dy)
    wc = (1.0 - dx) * dy
    wd = dx * dy

    sampled = (
        source[y0, x0] * wa[..., None]
        + source[y0, x1] * wb[..., None]
        + source[y1, x0] * wc[..., None]
        + source[y1, x1] * wd[..., None]
    )
    return np.clip(sampled, 0, 255).astype("uint8")


def extract_perspective_image(
    panorama_path: Path,
    output_path: Path,
    yaw: float,
    pitch: float,
    fov: float,
    out_width: int,
    out_height: int,
) -> Dict[str, Any]:
    np, Image = import_image_stack()

    with Image.open(panorama_path) as image:
        image_rgba = image.convert("RGBA")
        source = np.asarray(image_rgba).astype("float32")

    eq_height, eq_width = source.shape[0], source.shape[1]
    aspect = out_width / out_height
    half_fov = math.radians(fov) / 2.0
    tan_half = math.tan(half_fov)

    xs = np.linspace(-1.0, 1.0, out_width, endpoint=False) + (1.0 / out_width)
    ys = np.linspace(1.0, -1.0, out_height, endpoint=False) - (1.0 / out_height)
    xv, yv = np.meshgrid(xs * tan_half * aspect, ys * tan_half)
    zv = np.ones_like(xv)

    norm = np.sqrt(xv ** 2 + yv ** 2 + zv ** 2)
    xv /= norm
    yv /= norm
    zv /= norm

    yaw_rad = math.radians(yaw)
    pitch_rad = math.radians(pitch)

    cos_yaw = math.cos(yaw_rad)
    sin_yaw = math.sin(yaw_rad)
    cos_pitch = math.cos(pitch_rad)
    sin_pitch = math.sin(pitch_rad)

    x1 = xv * cos_yaw + zv * sin_yaw
    z1 = -xv * sin_yaw + zv * cos_yaw
    y1 = yv

    y2 = y1 * cos_pitch - z1 * sin_pitch
    z2 = y1 * sin_pitch + z1 * cos_pitch
    x2 = x1

    lon = np.arctan2(x2, z2)
    lat = np.arcsin(np.clip(y2, -1.0, 1.0))

    src_x = ((lon / (2.0 * np.pi)) + 0.5) * (eq_width - 1)
    src_y = (0.5 - (lat / np.pi)) * (eq_height - 1)

    output = bilinear_sample(np, source, src_x, src_y)
    Image.fromarray(output, mode="RGBA").save(output_path)
    return image_metadata(output_path)


def command_extract_perspective(payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_output_dir()
    panorama_path = Path(str(payload.get("panoramaImagePath", "")).strip())
    if not panorama_path.exists():
        raise FileNotFoundError(f"Panorama image does not exist: {panorama_path}")

    yaw = float(payload.get("yaw", 0))
    pitch = float(payload.get("pitch", 0))
    fov = float(payload.get("fov", 90))
    out_width = int(payload.get("width", 1280))
    out_height = int(payload.get("height", 720))
    output_prefix = sanitize_name(str(payload.get("outputPrefix", "perspective")).strip() or "perspective")
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    output_path = OUTPUTS_DIR / f"{output_prefix}-{timestamp}.png"

    metadata = extract_perspective_image(
        panorama_path=panorama_path,
        output_path=output_path,
        yaw=yaw,
        pitch=pitch,
        fov=fov,
        out_width=out_width,
        out_height=out_height,
    )
    return {
        "ok": True,
        "command": "extract_perspective",
        "outputs": [
            {
                "path": str(output_path),
                "name": output_path.name,
                **metadata,
            }
        ],
    }


def command_shutdown() -> Dict[str, Any]:
    return {
        "ok": True,
        "command": "shutdown",
    }


def run_command(payload: Dict[str, Any]) -> Dict[str, Any]:
    command = str(payload.get("command", "")).strip()
    if not command:
        raise ValueError("command is required")

    if command == "health":
        return command_health()
    if command == "list_models":
        return command_list_models()
    if command == "shutdown":
        return command_shutdown()
    if command == "generate_panorama":
        return command_generate_panorama(payload)
    if command == "extract_perspective":
        return command_extract_perspective(payload)

    raise ValueError(f"Unsupported command: {command}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Storyboard Copilot bridge runner for HunyuanWorld panorama generation."
    )
    parser.add_argument(
        "--server",
        action="store_true",
        help="Run as a persistent JSON-line server over stdin/stdout.",
    )
    parser.add_argument(
        "--request-file",
        type=str,
        help="Path to a JSON request file.",
    )
    parser.add_argument(
        "--command",
        type=str,
        help="Shortcut command for simple requests like health.",
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


def response_from_error(command: Optional[str], error: Exception) -> Dict[str, Any]:
    return {
        "ok": False,
        "command": command,
        "error": f"{type(error).__name__}: {error}",
        "traceback": traceback.format_exc(),
    }


def run_server() -> int:
    ensure_output_dir()
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        request_id: Optional[str] = None
        try:
            payload = json.loads(line)
            if not isinstance(payload, dict):
                raise ValueError("request payload must be a JSON object")
            request_id = str(payload.get("requestId", "")).strip() or None
            response = run_command(payload)
        except Exception as error:
            command = None
            if "payload" in locals() and isinstance(payload, dict):
                command = str(payload.get("command", "")).strip() or None
            response = response_from_error(command, error)

        if request_id:
            response["requestId"] = request_id

        emit_server_response(response)
        if response.get("ok") and response.get("command") == "shutdown":
            break

    return 0


def main() -> int:
    ensure_output_dir()
    args = parse_args()
    if args.server:
        return run_server()

    payload = load_payload(args)
    try:
        response = run_command(payload)
    except Exception as error:
        response = response_from_error(str(payload.get("command", "")).strip() or None, error)

    print(json.dumps(response, ensure_ascii=False))
    return 0 if response.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
