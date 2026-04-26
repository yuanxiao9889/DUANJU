#!/usr/bin/env python
from __future__ import annotations

import argparse
import gc
import importlib
import json
import os
import re
import sys
import time
import traceback
import warnings
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
MODEL_DIR = MODELS_DIR / "RMBG-2.0"
RUNNER_FILE = Path(__file__).resolve()
SERVER_RESPONSE_PREFIX = "__SC_EXTENSION_RESPONSE__:"

os.environ.setdefault("HF_HOME", str(CACHE_DIR / "hf"))
os.environ.setdefault("MODELSCOPE_CACHE", str(CACHE_DIR / "modelscope"))
os.environ.setdefault("TRANSFORMERS_CACHE", str(CACHE_DIR / "transformers"))
os.environ.setdefault("PYTHONWARNINGS", "ignore")
warnings.filterwarnings("ignore")

MODEL_CACHE: Dict[str, Any] = {}
MODEL_SOURCE_PACKAGE = "_storyboard_rmbg2_model"


def debug_log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def sanitize_name(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip())
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
        importlib.import_module(module_name)
        return True
    except Exception:
        return False


def ensure_required_paths() -> Dict[str, bool]:
    has_model_weights = any(
        (MODEL_DIR / candidate).exists()
        for candidate in ("model.safetensors", "pytorch_model.bin")
    )
    checks = {
        "python": PYTHON_DIR.exists(),
        "model": MODEL_DIR.exists(),
        "modelCode": (MODEL_DIR / "birefnet.py").exists(),
        "modelConfig": (MODEL_DIR / "BiRefNet_config.py").exists(),
        "modelWeights": has_model_weights,
        "runner": RUNNER_FILE.exists(),
        "torch": is_module_available("torch"),
        "torchvision": is_module_available("torchvision"),
        "transformers": is_module_available("transformers"),
        "safetensors": is_module_available("safetensors"),
        "timm": is_module_available("timm"),
        "kornia": is_module_available("kornia"),
    }

    try:
        torch_module = importlib.import_module("torch")
        checks["cuda"] = bool(torch_module.cuda.is_available())
    except Exception:
        checks["cuda"] = False

    return checks


def load_runtime_modules() -> Dict[str, Any]:
    torch_module = importlib.import_module("torch")
    numpy_module = importlib.import_module("numpy")
    transforms_module = importlib.import_module("torchvision.transforms")
    pil_image_module = importlib.import_module("PIL.Image")
    safetensors_torch_module = importlib.import_module("safetensors.torch")

    return {
        "torch": torch_module,
        "np": numpy_module,
        "transforms": transforms_module,
        "Image": pil_image_module,
        "load_safetensors_file": safetensors_torch_module.load_file,
    }


def clear_model_cache() -> None:
    MODEL_CACHE.clear()
    gc.collect()

    try:
        torch_module = importlib.import_module("torch")
    except Exception:
        return

    if torch_module.cuda.is_available():
        try:
            torch_module.cuda.empty_cache()
        except Exception:
            pass


def ensure_inference_ready() -> Dict[str, Any]:
    checks = ensure_required_paths()
    failed_checks = [name for name, passed in checks.items() if not passed]
    if failed_checks:
        raise RuntimeError(
            "RMBG runtime checks failed: " + ", ".join(failed_checks)
        )

    return load_runtime_modules()


def load_python_module(module_name: str, file_path: Path) -> Any:
    existing_module = sys.modules.get(module_name)
    if existing_module is not None:
        return existing_module

    spec = importlib.util.spec_from_file_location(module_name, file_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load Python module from: {file_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def load_model_source_modules() -> Dict[str, Any]:
    cache_key = "rmbg2_source_modules"
    cached = MODEL_CACHE.get(cache_key)
    if cached is not None:
        return cached

    package_module = sys.modules.get(MODEL_SOURCE_PACKAGE)
    if package_module is None:
        package_module = importlib.util.module_from_spec(
            importlib.machinery.ModuleSpec(
                MODEL_SOURCE_PACKAGE,
                loader=None,
                is_package=True,
            )
        )
        package_module.__path__ = [str(MODEL_DIR)]
        sys.modules[MODEL_SOURCE_PACKAGE] = package_module

    config_module = load_python_module(
        f"{MODEL_SOURCE_PACKAGE}.BiRefNet_config",
        MODEL_DIR / "BiRefNet_config.py",
    )
    model_module = load_python_module(
        f"{MODEL_SOURCE_PACKAGE}.birefnet",
        MODEL_DIR / "birefnet.py",
    )

    loaded_modules = {
        "BiRefNet": model_module.BiRefNet,
        "BiRefNetConfig": config_module.BiRefNetConfig,
    }
    MODEL_CACHE[cache_key] = loaded_modules
    return loaded_modules


def resolve_model_weights_path() -> Path:
    for candidate in ("model.safetensors", "pytorch_model.bin"):
        weights_path = MODEL_DIR / candidate
        if weights_path.exists():
            return weights_path

    raise FileNotFoundError(f"RMBG weights are missing in {MODEL_DIR}")


def load_model_state_dict(torch_module: Any, load_safetensors_file: Any) -> tuple[Dict[str, Any], Path]:
    weights_path = resolve_model_weights_path()
    if weights_path.suffix == ".safetensors":
        state_dict = load_safetensors_file(str(weights_path))
    else:
        state_dict = torch_module.load(str(weights_path), map_location="cpu")

    if isinstance(state_dict, dict) and isinstance(state_dict.get("state_dict"), dict):
        state_dict = state_dict["state_dict"]

    if not isinstance(state_dict, dict):
        raise RuntimeError("RMBG weights file did not resolve to a state_dict.")

    return state_dict, weights_path


def get_model() -> tuple[Any, Any]:
    cache_key = "rmbg2"
    if cache_key in MODEL_CACHE:
        cached = MODEL_CACHE[cache_key]
        return cached["model"], cached["torch"]

    modules = ensure_inference_ready()
    torch_module = modules["torch"]
    model_modules = load_model_source_modules()
    state_dict, weights_path = load_model_state_dict(
        torch_module,
        modules["load_safetensors_file"],
    )
    model_config = model_modules["BiRefNetConfig"](bb_pretrained=False)
    model = model_modules["BiRefNet"](config=model_config)
    incompatible_keys = model.load_state_dict(state_dict, strict=False)
    if incompatible_keys.missing_keys or incompatible_keys.unexpected_keys:
        raise RuntimeError(
            "RMBG weights mismatch: "
            f"missing={len(incompatible_keys.missing_keys)}, "
            f"unexpected={len(incompatible_keys.unexpected_keys)}"
        )

    model = model.to("cuda")
    model.eval()

    MODEL_CACHE[cache_key] = {
        "model": model,
        "torch": torch_module,
        "weightsPath": str(weights_path),
    }
    return model, torch_module


def next_output_path(prefix: str, extension: str) -> Path:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    milliseconds = int((time.time() % 1) * 1000)
    return OUTPUTS_DIR / f"{sanitize_name(prefix)}-{timestamp}-{milliseconds:03d}.{extension}"


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


def build_input_transform(transforms_module: Any) -> Any:
    return transforms_module.Compose(
        [
            transforms_module.Resize((1024, 1024)),
            transforms_module.ToTensor(),
            transforms_module.Normalize(
                [0.485, 0.456, 0.406],
                [0.229, 0.224, 0.225],
            ),
        ]
    )


def predict_alpha_mask(image: Any) -> tuple[Any, Any]:
    modules = ensure_inference_ready()
    model, torch_module = get_model()
    transforms_module = modules["transforms"]

    source_image = image.convert("RGB")
    input_tensor = build_input_transform(transforms_module)(source_image).unsqueeze(0).to("cuda")

    with torch_module.no_grad():
        predictions = model(input_tensor)

    if not isinstance(predictions, (list, tuple)) or len(predictions) == 0:
        raise RuntimeError("RMBG model did not return prediction tensors.")

    prediction = predictions[-1].sigmoid().cpu()
    if prediction.ndim != 4:
        raise RuntimeError("Unexpected RMBG prediction shape.")

    alpha_tensor = prediction[0].squeeze(0).detach().float().cpu().clamp(0, 1)
    alpha_mask = transforms_module.ToPILImage()(alpha_tensor)
    alpha_mask = alpha_mask.resize(image.size)
    return alpha_mask, alpha_tensor


def warmup_model() -> Dict[str, Any]:
    started_at = time.time()
    _modules = ensure_inference_ready()
    model, torch_module = get_model()

    dummy_input = torch_module.zeros((1, 3, 1024, 1024), device="cuda")
    with torch_module.no_grad():
        predictions = model(dummy_input)
        if not isinstance(predictions, (list, tuple)) or len(predictions) == 0:
            raise RuntimeError("RMBG warmup failed to return a prediction tensor.")
        prediction = predictions[-1]
        if getattr(prediction, "ndim", None) != 4:
            raise RuntimeError("RMBG warmup returned an unexpected prediction shape.")

    if torch_module.cuda.is_available():
        try:
            torch_module.cuda.synchronize()
        except Exception:
            pass

    elapsed_ms = int((time.time() - started_at) * 1000)
    return {
        "model": "rmbg2",
        "device": "cuda",
        "elapsedMs": elapsed_ms,
        "modelClass": model.__class__.__name__,
    }


def command_health() -> Dict[str, Any]:
    checks = ensure_required_paths()
    return {
        "ok": all(checks.values()),
        "command": "health",
        "checks": checks,
        "versions": {
            "torch": resolve_dist_version("torch"),
            "torchvision": resolve_dist_version("torchvision"),
            "transformers": resolve_dist_version("transformers"),
            "safetensors": resolve_dist_version("safetensors"),
            "timm": resolve_dist_version("timm"),
            "kornia": resolve_dist_version("kornia"),
        },
        "device": "cuda" if checks.get("cuda") else "unavailable",
    }


def command_list_models() -> Dict[str, Any]:
    return {
        "ok": True,
        "command": "list_models",
        "models": [
            {
                "id": "rmbg2",
                "path": str(MODEL_DIR),
                "exists": MODEL_DIR.exists(),
            }
        ],
    }


def command_warmup(_payload: Dict[str, Any]) -> Dict[str, Any]:
    warmed_model = warmup_model()
    return {
        "ok": True,
        "command": "warmup",
        "warmedModels": [warmed_model],
        "cachedModels": list(MODEL_CACHE.keys()),
    }


def command_remove_background(payload: Dict[str, Any]) -> Dict[str, Any]:
    modules = ensure_inference_ready()
    pil_image = modules["Image"]

    image_path = normalize_file_path(payload.get("imagePath"), "imagePath")
    output_prefix = normalize_optional_text(payload.get("outputPrefix")) or "background-removed"

    with pil_image.open(image_path) as source_image:
        prepared_source = source_image.convert("RGBA")
        alpha_mask, _prediction = predict_alpha_mask(source_image)
        prepared_source.putalpha(alpha_mask)

        output_path = next_output_path(output_prefix, "png")
        prepared_source.save(output_path, format="PNG")

    return {
        "ok": True,
        "command": "remove_background",
        "output": {
            "path": str(output_path),
            "name": output_path.name,
            "mimeType": "image/png",
            "width": prepared_source.width,
            "height": prepared_source.height,
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
    if command == "remove_background":
        return command_remove_background(payload)
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
            "error": traceback.format_exc().strip().splitlines()[-1] or "Unknown RMBG runner error",
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
