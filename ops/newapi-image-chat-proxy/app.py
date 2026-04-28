import asyncio
import base64
import copy
import logging
import math
import mimetypes
import os
import re
import time
import uuid
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse
from starlette.datastructures import FormData, UploadFile


logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("newapi-image-chat-proxy")


UPSTREAM_BASE_URL = os.getenv("UPSTREAM_BASE_URL", "https://ai.dearglory.cn").rstrip("/")
REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "180"))
DEFAULT_RESPONSE_FORMAT = os.getenv("DEFAULT_RESPONSE_FORMAT", "url")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
GENERATED_DIR = os.getenv("GENERATED_DIR", "/app/generated")
DEBUG_IMAGE_URL = os.getenv("DEBUG_IMAGE_URL", "").strip()

DATA_URL_RE = re.compile(r"^data:(?P<mime>[^;]+);base64,(?P<data>.+)$", re.DOTALL)
EXACT_SIZE_RE = re.compile(r"^(?P<width>\d+)\s*[xX]\s*(?P<height>\d+)$")
PROMPT_SIZE_TAG_RE = re.compile(
    r"\[\s*__gpt2api_image_size\s*=\s*(?P<size>\d+\s*[xX]\s*\d+)\s*__\s*\]",
    re.IGNORECASE,
)
OPENAI_IMAGE_SIZE_PRESETS: dict[str, dict[str, str]] = {
    "1K": {
        "1:1": "1024x1024",
        "5:4": "1120x896",
        "9:16": "720x1280",
        "21:9": "1456x624",
        "16:9": "1280x720",
        "4:3": "1152x864",
        "3:2": "1248x832",
        "4:5": "896x1120",
        "3:4": "864x1152",
        "2:3": "832x1248",
    },
    "2K": {
        "1:1": "2048x2048",
        "5:4": "2240x1792",
        "9:16": "1440x2560",
        "21:9": "3024x1296",
        "16:9": "2560x1440",
        "4:3": "2304x1728",
        "3:2": "2496x1664",
        "4:5": "1792x2240",
        "3:4": "1728x2304",
        "2:3": "1664x2496",
    },
    "4K": {
        "1:1": "2880x2880",
        "5:4": "3200x2560",
        "9:16": "2160x3840",
        "21:9": "3696x1584",
        "16:9": "3840x2160",
        "4:3": "3264x2448",
        "3:2": "3504x2336",
        "4:5": "2560x3200",
        "3:4": "2448x3264",
        "2:3": "2336x3504",
    },
}
OPENAI_IMAGE_TARGET_PIXELS = {
    "1K": 1024 * 1024,
    "2K": 2048 * 2048,
    "4K": 3840 * 2160,
}
OPENAI_IMAGE_MIN_TOTAL_PIXELS = 655_360
OPENAI_IMAGE_MAX_TOTAL_PIXELS = 16_777_216
OPENAI_IMAGE_MAX_EDGE = 4096
OPENAI_IMAGE_DIMENSION_STEP = 16
OPENAI_IMAGE_MAX_ASPECT_RATIO = 3.0
OPENAI_IMAGE_MIN_ASPECT_RATIO = 1.0 / OPENAI_IMAGE_MAX_ASPECT_RATIO
HTTP_CLIENT = httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
os.makedirs(GENERATED_DIR, exist_ok=True)

app = FastAPI(title="NewAPI Image Chat Proxy")


def build_upstream_url(path: str) -> str:
    return f"{UPSTREAM_BASE_URL}{path}"


def first_non_empty_string(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str):
            stripped = value.strip()
            if stripped:
                return stripped
    return None


def get_nested_dict_value(source: Any, *keys: str) -> str | None:
    value = source
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value.strip() if isinstance(value, str) and value.strip() else None


def normalize_resolution_token(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().upper()
    return normalized if normalized in OPENAI_IMAGE_SIZE_PRESETS else None


def infer_resolution_token_from_model(model: Any) -> str | None:
    if not isinstance(model, str):
        return None
    normalized = model.strip().lower()
    if "-4k-" in normalized or normalized.endswith("-4k"):
        return "4K"
    if "-2k-" in normalized or normalized.endswith("-2k"):
        return "2K"
    if normalized.startswith("gpt-image-2"):
        return "1K"
    return None


def parse_aspect_ratio(value: Any) -> float | None:
    if not isinstance(value, str):
        return None
    raw_width, raw_height = value.split(":", 1) if ":" in value else (None, None)
    if raw_width is None or raw_height is None:
        return None
    try:
        width = float(raw_width.strip())
        height = float(raw_height.strip())
    except ValueError:
        return None
    if width <= 0 or height <= 0:
        return None
    return width / height


def parse_exact_size(value: Any) -> tuple[int, int] | None:
    if not isinstance(value, str):
        return None
    matched = EXACT_SIZE_RE.match(value.strip())
    if not matched:
        return None
    width = int(matched.group("width"))
    height = int(matched.group("height"))
    if width <= 0 or height <= 0:
        return None
    return width, height


def format_exact_size(width: int, height: int) -> str:
    return f"{width}x{height}"


def clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def quantize_dimension(value: float) -> int:
    rounded = int(round(value / OPENAI_IMAGE_DIMENSION_STEP) * OPENAI_IMAGE_DIMENSION_STEP)
    return clamp(rounded, OPENAI_IMAGE_DIMENSION_STEP, OPENAI_IMAGE_MAX_EDGE)


def is_supported_openai_image_size(width: int, height: int) -> bool:
    if width <= 0 or height <= 0:
        return False
    if width > OPENAI_IMAGE_MAX_EDGE or height > OPENAI_IMAGE_MAX_EDGE:
        return False
    if width % OPENAI_IMAGE_DIMENSION_STEP != 0 or height % OPENAI_IMAGE_DIMENSION_STEP != 0:
        return False
    total_pixels = width * height
    if total_pixels < OPENAI_IMAGE_MIN_TOTAL_PIXELS or total_pixels > OPENAI_IMAGE_MAX_TOTAL_PIXELS:
        return False
    aspect_ratio = width / height
    return OPENAI_IMAGE_MIN_ASPECT_RATIO <= aspect_ratio <= OPENAI_IMAGE_MAX_ASPECT_RATIO


def canonicalize_explicit_size(value: Any) -> str | None:
    exact_size = parse_exact_size(value)
    if not exact_size:
        return None
    width, height = exact_size
    width = quantize_dimension(float(width))
    height = quantize_dimension(float(height))
    if not is_supported_openai_image_size(width, height):
        return None
    return format_exact_size(width, height)


def extract_prompt_size_tag(prompt: str) -> tuple[str, str | None]:
    matched = PROMPT_SIZE_TAG_RE.search(prompt)
    if not matched:
        return prompt.strip(), None
    resolved_size = canonicalize_explicit_size(matched.group("size"))
    cleaned_prompt = PROMPT_SIZE_TAG_RE.sub(" ", prompt)
    cleaned_prompt = re.sub(r"\n{3,}", "\n\n", cleaned_prompt)
    return cleaned_prompt.strip(), resolved_size


def resolve_preset_size(resolution_token: str, aspect_ratio: str | None) -> str | None:
    if not aspect_ratio:
        return OPENAI_IMAGE_SIZE_PRESETS[resolution_token]["1:1"]
    return OPENAI_IMAGE_SIZE_PRESETS[resolution_token].get(aspect_ratio.strip())


def resolve_dynamic_size(resolution_token: str, aspect_ratio: str | None) -> str | None:
    ratio = parse_aspect_ratio(aspect_ratio or "1:1") or 1.0
    ratio = max(OPENAI_IMAGE_MIN_ASPECT_RATIO, min(OPENAI_IMAGE_MAX_ASPECT_RATIO, ratio))
    target_pixels = OPENAI_IMAGE_TARGET_PIXELS.get(resolution_token, OPENAI_IMAGE_TARGET_PIXELS["1K"])
    width = math.sqrt(target_pixels * ratio)
    height = math.sqrt(target_pixels / ratio)

    if width > OPENAI_IMAGE_MAX_EDGE:
        width = float(OPENAI_IMAGE_MAX_EDGE)
        height = width / ratio
    if height > OPENAI_IMAGE_MAX_EDGE:
        height = float(OPENAI_IMAGE_MAX_EDGE)
        width = height * ratio

    width_value = quantize_dimension(width)
    height_value = quantize_dimension(height)

    if not is_supported_openai_image_size(width_value, height_value):
        return None
    return format_exact_size(width_value, height_value)


def sanitize_extra_body(extra_body: Any) -> dict[str, Any] | None:
    if not isinstance(extra_body, dict):
        return None

    sanitized = copy.deepcopy(extra_body)
    google_config = sanitized.get("google")
    if isinstance(google_config, dict):
        image_config = google_config.get("image_config")
        if isinstance(image_config, dict):
            image_config.pop("aspect_ratio", None)
            image_config.pop("image_size", None)
            if not image_config:
                google_config.pop("image_config", None)
        if not google_config:
            sanitized.pop("google", None)
    return sanitized or None


def resolve_compatible_openai_size(source: dict[str, Any]) -> tuple[str | None, str]:
    prompt_value = source.get("prompt")
    prompt = prompt_value if isinstance(prompt_value, str) else ""
    cleaned_prompt, prompt_size = extract_prompt_size_tag(prompt)

    top_level_size = first_non_empty_string(source.get("size"))
    top_level_image_size = first_non_empty_string(source.get("image_size"))
    top_level_aspect_ratio = first_non_empty_string(source.get("aspect_ratio"))
    nested_image_size = get_nested_dict_value(source.get("extra_body"), "google", "image_config", "image_size")
    nested_aspect_ratio = get_nested_dict_value(
        source.get("extra_body"),
        "google",
        "image_config",
        "aspect_ratio",
    )

    aspect_ratio = top_level_aspect_ratio or nested_aspect_ratio
    exact_size_candidates = [prompt_size, top_level_size, top_level_image_size, nested_image_size]
    for candidate in exact_size_candidates:
        explicit_exact_size = canonicalize_explicit_size(candidate)
        if explicit_exact_size:
            return explicit_exact_size, cleaned_prompt

    resolution_token = (
        normalize_resolution_token(top_level_size)
        or normalize_resolution_token(top_level_image_size)
        or normalize_resolution_token(nested_image_size)
        or infer_resolution_token_from_model(source.get("model"))
    )
    has_auto_size = any(
        isinstance(candidate, str) and candidate.strip().lower() == "auto"
        for candidate in exact_size_candidates
    )

    if not resolution_token and not aspect_ratio:
        if has_auto_size:
            return "auto", cleaned_prompt
        return None, cleaned_prompt

    resolution_token = resolution_token or "1K"
    preset_size = resolve_preset_size(resolution_token, aspect_ratio)
    if preset_size:
        return preset_size, cleaned_prompt

    return resolve_dynamic_size(resolution_token, aspect_ratio), cleaned_prompt


def build_generation_forward_body(source: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    resolved_size, cleaned_prompt = resolve_compatible_openai_size(source)
    body: dict[str, Any] = {
        "model": source.get("model"),
        "prompt": cleaned_prompt,
        "response_format": source.get("response_format") or DEFAULT_RESPONSE_FORMAT,
    }
    if resolved_size:
        body["size"] = resolved_size

    for key in [
        "n",
        "quality",
        "style",
        "background",
        "user",
        "image_backend",
        "moderation",
        "output_format",
    ]:
        value = source.get(key)
        if value not in (None, ""):
            body[key] = value

    extra_body = sanitize_extra_body(source.get("extra_body"))
    if isinstance(extra_body, dict):
        for key, value in extra_body.items():
            if key not in body:
                body[key] = value

    debug = {
        "model": source.get("model"),
        "raw_size": source.get("size"),
        "raw_image_size": source.get("image_size"),
        "raw_aspect_ratio": source.get("aspect_ratio"),
        "resolved_size": resolved_size,
    }
    return body, debug


def filter_forward_headers(request: Request) -> dict[str, str]:
    allowed_headers = [
        "authorization",
        "x-api-key",
        "api-key",
        "x-request-id",
    ]
    headers: dict[str, str] = {}
    for name in allowed_headers:
        value = request.headers.get(name)
        if value:
            headers[name] = value
    return headers


def extract_text_and_images(messages: list[Any]) -> tuple[str, list[str]]:
    text_parts: list[str] = []
    image_sources: list[str] = []

    for message in messages:
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            if content.strip():
                text_parts.append(content.strip())
            continue
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "text":
                text = part.get("text")
                if isinstance(text, str) and text.strip():
                    text_parts.append(text.strip())
                continue
            if part.get("type") == "image_url":
                image_url = part.get("image_url")
                if isinstance(image_url, dict):
                    image_url = image_url.get("url")
                if isinstance(image_url, str) and image_url.strip():
                    image_sources.append(image_url.strip())

    prompt = "\n\n".join(part for part in text_parts if part)
    return prompt, image_sources


def guess_filename(mime_type: str | None, fallback: str = "image.png") -> str:
    if not mime_type:
        return fallback
    extension = mimetypes.guess_extension(mime_type) or ".png"
    return f"image{extension}"


def file_extension_for_mime_type(mime_type: str | None) -> str:
    if not mime_type:
        return ".png"
    return mimetypes.guess_extension(mime_type) or ".png"


async def source_to_file_tuple(source: str) -> tuple[str, bytes, str]:
    matched = DATA_URL_RE.match(source)
    if matched:
        mime_type = matched.group("mime").strip() or "image/png"
        raw = base64.b64decode(matched.group("data"))
        return guess_filename(mime_type), raw, mime_type

    if source.startswith("http://") or source.startswith("https://"):
        response = await HTTP_CLIENT.get(source)
        response.raise_for_status()
        mime_type = response.headers.get("content-type", "image/png").split(";")[0].strip()
        path = urlparse(source).path
        filename = os.path.basename(path) or guess_filename(mime_type)
        return filename, response.content, mime_type

    raise HTTPException(status_code=400, detail="Unsupported image source in chat content")


def passthrough_generation_fields(source: dict[str, Any]) -> dict[str, Any]:
    body, debug = build_generation_forward_body(source)
    logger.info(
        "normalized image request model=%s raw_size=%s raw_image_size=%s raw_aspect_ratio=%s final_size=%s",
        debug["model"],
        debug["raw_size"],
        debug["raw_image_size"],
        debug["raw_aspect_ratio"],
        debug["resolved_size"],
    )
    return body


def extract_first_image(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None

    direct_url_paths = [
        ("generated_assets", "upscaled_image", "url"),
        ("generated_assets", "upscaled_image", "local_url"),
        ("generated_assets", "final_image_url"),
        ("url",),
        ("result", "url"),
        ("data", 0, "url"),
        ("choices", 0, "message", "images", 0, "url"),
        ("choices", 0, "message", "image", "url"),
        ("choices", 0, "message", "output", 0, "image_url", "url"),
    ]
    for path in direct_url_paths:
        value = payload
        for key in path:
            if isinstance(key, int):
                if not isinstance(value, list) or len(value) <= key:
                    value = None
                    break
                value = value[key]
            else:
                if not isinstance(value, dict):
                    value = None
                    break
                value = value.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    direct_b64_paths = [
        ("data", 0, "b64_json"),
        ("choices", 0, "message", "images", 0, "b64_json"),
        ("choices", 0, "message", "image", "b64_json"),
    ]
    for path in direct_b64_paths:
        value = payload
        for key in path:
            if isinstance(key, int):
                if not isinstance(value, list) or len(value) <= key:
                    value = None
                    break
                value = value[key]
            else:
                if not isinstance(value, dict):
                    value = None
                    break
                value = value.get(key)
        if isinstance(value, str) and value.strip():
            return f"data:image/png;base64,{value.strip()}"

    message = None
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            message = first.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str):
            match = re.search(r"\((https?://[^)]+|data:[^)]+)\)", content)
            if match:
                return match.group(1)

    return None


def build_chat_completion_payload(
    image_source: str,
    model: str,
) -> dict[str, Any]:
    message = {
        "role": "assistant",
        "content": [
            {
                "type": "text",
                "text": "Generated image.",
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": image_source,
                },
            },
        ],
        "images": [{"url": image_source}],
        "image": {"url": image_source},
    }
    data_item = {"url": image_source}

    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": message,
            }
        ],
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": 1,
            "total_tokens": 1,
        },
        "data": [data_item],
    }


async def post_json(path: str, headers: dict[str, str], body: dict[str, Any]) -> httpx.Response:
    return await HTTP_CLIENT.post(build_upstream_url(path), headers=headers, json=body)


async def post_multipart(
    path: str,
    headers: dict[str, str],
    data: list[tuple[str, str]],
    files: list[tuple[str, tuple[str, bytes, str]]],
) -> httpx.Response:
    # httpx sync multipart breaks when text fields are passed as a list of tuples
    # together with files, so normalize the scalar fields to a plain dict first.
    normalized_data = {key: value for key, value in data}

    def _send() -> httpx.Response:
        with httpx.Client(timeout=REQUEST_TIMEOUT) as client:
            return client.post(
                build_upstream_url(path),
                headers=headers,
                data=normalized_data,
                files=files,
            )

    return await asyncio.to_thread(_send)


def relay_error(response: httpx.Response) -> JSONResponse:
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            payload = response.json()
        except Exception:
            payload = {"error": {"message": response.text}}
    else:
        payload = {"error": {"message": response.text}}
    return JSONResponse(status_code=response.status_code, content=payload)


def relay_exception(error: Exception) -> JSONResponse:
    if isinstance(error, httpx.TimeoutException):
        return JSONResponse(
            status_code=504,
            content={"error": {"message": f"Proxy upstream timeout: {error}"}},
        )

    if isinstance(error, httpx.HTTPError):
        return JSONResponse(
            status_code=502,
            content={"error": {"message": f"Proxy upstream request failed: {error}"}},
        )

    logger.exception("proxy unexpected error")
    return JSONResponse(
        status_code=500,
        content={"error": {"message": f"Proxy internal error: {type(error).__name__}: {error}"}},
    )


async def persist_image_source_as_public_file(image_source: str) -> str:
    if not PUBLIC_BASE_URL:
        return image_source

    matched = DATA_URL_RE.match(image_source)
    try:
        if matched:
            mime_type = matched.group("mime").strip() or "image/png"
            raw = base64.b64decode(matched.group("data"))
        elif image_source.startswith("http://") or image_source.startswith("https://"):
            response = await HTTP_CLIENT.get(image_source)
            response.raise_for_status()
            mime_type = response.headers.get("content-type", "image/png").split(";")[0].strip()
            raw = response.content
        else:
            return image_source

        extension = file_extension_for_mime_type(mime_type)
        filename = f"{uuid.uuid4().hex}{extension}"
        file_path = os.path.join(GENERATED_DIR, filename)
        with open(file_path, "wb") as output:
            output.write(raw)
        return f"{PUBLIC_BASE_URL}/proxy-images/{filename}"
    except Exception as error:
        logger.warning("failed to mirror upstream image source, using original url: %s", error)
        return image_source


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/proxy-images/{filename}")
async def proxy_image(filename: str) -> FileResponse:
    file_path = os.path.join(GENERATED_DIR, os.path.basename(filename))
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="image not found")
    return FileResponse(file_path)


@app.post("/chat/completions")
@app.post("/v1/chat/completions")
async def chat_completions(request: Request) -> JSONResponse:
    body = await request.json()
    model = body.get("model")
    if not isinstance(model, str) or not model.strip():
        raise HTTPException(status_code=400, detail="model is required")
    if body.get("stream") is True:
        raise HTTPException(status_code=400, detail="streaming is not supported by this proxy")

    prompt, image_sources = extract_text_and_images(body.get("messages") or [])
    if not prompt and isinstance(body.get("prompt"), str):
        prompt = body["prompt"].strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")

    if prompt.strip() == "__proxy_debug__" and DEBUG_IMAGE_URL:
        return JSONResponse(
            status_code=200,
            content=build_chat_completion_payload(DEBUG_IMAGE_URL, model),
        )

    headers = filter_forward_headers(request)
    try:
        if image_sources:
            edits_body, debug = build_generation_forward_body({"model": model, "prompt": prompt, **body})
            form_fields = [
                (key, str(value))
                for key, value in edits_body.items()
                if value not in (None, "")
            ]

            files: list[tuple[str, tuple[str, bytes, str]]] = []
            field_name = "image[]" if len(image_sources) > 1 else "image"
            for source in image_sources:
                filename, raw, mime_type = await source_to_file_tuple(source)
                files.append((field_name, (filename, raw, mime_type)))

            logger.info(
                "chat->images/edits model=%s refs=%s final_size=%s",
                model,
                len(image_sources),
                debug["resolved_size"],
            )
            upstream_response = await post_multipart("/v1/images/edits", headers, form_fields, files)
        else:
            generation_body = passthrough_generation_fields({"model": model, "prompt": prompt, **body})
            logger.info("chat->images/generations model=%s", model)
            upstream_response = await post_json("/v1/images/generations", headers, generation_body)
    except Exception as error:
        return relay_exception(error)

    if upstream_response.status_code >= 400:
        return relay_error(upstream_response)

    payload = upstream_response.json()
    image_source = extract_first_image(payload)
    if not image_source:
        logger.error("upstream response did not contain an image: %s", payload)
        return JSONResponse(
            status_code=502,
            content={"error": {"message": "Upstream image response did not contain a usable image"}},
        )
    image_source = await persist_image_source_as_public_file(image_source)

    return JSONResponse(
        status_code=200,
        content=build_chat_completion_payload(image_source, model),
    )


@app.post("/images/generations")
@app.post("/v1/images/generations")
async def images_generations(request: Request) -> JSONResponse:
    body = await request.json()
    headers = filter_forward_headers(request)
    logger.info("passthrough images/generations model=%s", body.get("model"))
    try:
        generation_body = passthrough_generation_fields(body)
        upstream_response = await post_json(
            "/v1/images/generations",
            headers,
            generation_body,
        )
    except Exception as error:
        return relay_exception(error)
    if upstream_response.status_code >= 400:
        return relay_error(upstream_response)
    return JSONResponse(status_code=upstream_response.status_code, content=upstream_response.json())


async def build_forwarded_multipart(form: FormData) -> tuple[list[tuple[str, str]], list[tuple[str, tuple[str, bytes, str]]]]:
    data: list[tuple[str, str]] = []
    files: list[tuple[str, tuple[str, bytes, str]]] = []
    for key, value in form.multi_items():
        if isinstance(value, UploadFile):
            raw = await value.read()
            content_type = value.content_type or "application/octet-stream"
            filename = value.filename or guess_filename(content_type, "upload.bin")
            files.append((key, (filename, raw, content_type)))
        else:
            data.append((key, str(value)))
    return data, files


def normalize_forwarded_multipart_fields(data: list[tuple[str, str]]) -> tuple[list[tuple[str, str]], dict[str, Any]]:
    source = {key: value for key, value in data}
    normalized_body, debug = build_generation_forward_body(source)

    normalized_keys = set(normalized_body.keys())
    skipped_keys = {"size", "image_size", "aspect_ratio"}
    normalized_data = [
        (key, str(value))
        for key, value in normalized_body.items()
        if value not in (None, "")
    ]
    normalized_data.extend(
        (key, value)
        for key, value in data
        if key not in normalized_keys and key not in skipped_keys
    )
    return normalized_data, debug


@app.post("/images/edits")
@app.post("/v1/images/edits")
async def images_edits(request: Request) -> JSONResponse:
    headers = filter_forward_headers(request)
    form = await request.form()
    data, files = await build_forwarded_multipart(form)
    data, debug = normalize_forwarded_multipart_fields(data)
    logger.info(
        "passthrough images/edits fields=%s files=%s final_size=%s",
        len(data),
        len(files),
        debug["resolved_size"],
    )
    try:
        upstream_response = await post_multipart("/v1/images/edits", headers, data, files)
    except Exception as error:
        return relay_exception(error)
    if upstream_response.status_code >= 400:
        return relay_error(upstream_response)
    return JSONResponse(status_code=upstream_response.status_code, content=upstream_response.json())


@app.on_event("shutdown")
async def shutdown_client() -> None:
    await HTTP_CLIENT.aclose()
