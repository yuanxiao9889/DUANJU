# SeedVR2 Complete

This template assembles a full offline Storyboard Copilot extension for SeedVR2 image and video upscaling.

## Included runtime pieces

- Portable Python runtime
- Packaged SeedVR2 upstream source code
- Default DiT weight: `seedvr2_ema_3b_fp8_e4m3fn.safetensors`
- Default VAE weight: `ema_vae_fp16.safetensors`
- Bundled ffmpeg and ffprobe for video writing and audio remux

## Fixed presets

- Image node: only exposes target resolution `1080 / 1440 / 2160`
- Video node: only exposes target resolution `720 / 1080 / 1440`
- Advanced SeedVR2 parameters are fixed inside the runner and are not user configurable

## Attribution

- Upstream project: `numz/ComfyUI-SeedVR2_VideoUpscaler`
- Upstream license: Apache 2.0
- Keep model provenance and any upstream usage restrictions with the packaged extension
