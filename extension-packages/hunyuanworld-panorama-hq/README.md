# HunyuanWorld Panorama HQ

This folder is a high-quality 360 panorama bridge package for Storyboard Copilot.

It does not bundle HunyuanWorld itself. Instead, it connects the app to your local
`HunyuanWorld-1.0` checkout and exposes two canvas nodes:

- `panoramaNode`
- `panoramaResultNode`

## What it can do

- Generate a high-quality 2:1 equirectangular panorama from one upstream image
- Extract perspective views from a generated panorama so you can branch into
  regular image nodes

## Setup

1. Clone `Tencent-Hunyuan/HunyuanWorld-1.0` somewhere on your machine.
2. Prepare a Python environment that can run `demo_panogen.py`.
3. Set these environment variables before launching Storyboard Copilot:

```powershell
$env:HUNYUANWORLD_REPO = "D:\ai\HunyuanWorld-1.0"
$env:HUNYUANWORLD_PYTHON = "D:\ai\HunyuanWorld-1.0\.venv\Scripts\python.exe"
```

Optional:

```powershell
$env:HUNYUANWORLD_SCRIPT = "demo_panogen.py"
```

## Load in Extensions Center

Load this folder:

- `E:\Storyboard-Copilot\extension-packages\hunyuanworld-panorama-hq`

## Build a complete package

If you want a portable package that also bundles a Python runtime plus a vendored
`HunyuanWorld-1.0` checkout, run:

```powershell
npm run prepare:hunyuanworld-panorama-extension -- `
  --repo-source D:\ai\HunyuanWorld-1.0 `
  --runtime-source E:\Storyboard-Copilot\extension-packages\qwen3-tts-complete\runtime\python
```

If you do not have a local `HunyuanWorld-1.0` checkout, the prepare script can
download the official repo from GitHub automatically:

```powershell
npm run prepare:hunyuanworld-panorama-extension -- `
  --runtime-source E:\Storyboard-Copilot\extension-packages\qwen3-tts-complete\runtime\python
```

To also pre-download the official Hugging Face model repos into the package cache:

```powershell
$env:HF_TOKEN = "hf_xxx"
npm run prepare:hunyuanworld-panorama-extension -- `
  --runtime-source E:\Storyboard-Copilot\extension-packages\qwen3-tts-complete\runtime\python `
  --download-models
```

The current official panorama pipeline depends on:

- `tencent/HunyuanWorld-1`
- `black-forest-labs/FLUX.1-dev`
- `black-forest-labs/FLUX.1-Fill-dev`

If `HF_HOME` download fails, check network reachability to `huggingface.co` and
make sure your Hugging Face account has access to any gated repos.

The assembled output is written to:

- `E:\Storyboard-Copilot\build\extensions\hunyuanworld-panorama-hq-complete`

To create a zip archive after assembly:

```powershell
$env:HUNYUANWORLD_REPO = "D:\ai\HunyuanWorld-1.0"
npm run package:hunyuanworld-panorama-extension
```

If you already assembled the output folder, you can package it directly:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-hunyuanworld-panorama-extension.ps1 `
  -SourceDir E:\Storyboard-Copilot\build\extensions\hunyuanworld-panorama-hq-complete
```

## Quick checks

Health:

```powershell
E:\Storyboard-Copilot\extension-packages\hunyuanworld-panorama-hq\runtime\python\python.cmd `
  -u E:\Storyboard-Copilot\extension-packages\hunyuanworld-panorama-hq\runtime\app\storyboard_panorama_runner.py `
  --command health
```

List models:

```powershell
E:\Storyboard-Copilot\extension-packages\hunyuanworld-panorama-hq\runtime\python\python.cmd `
  -u E:\Storyboard-Copilot\extension-packages\hunyuanworld-panorama-hq\runtime\app\storyboard_panorama_runner.py `
  --command list_models
```

## Notes

- `generate_panorama` shells out to the local HunyuanWorld demo script.
- `extract_perspective` is handled by the bridge package itself and writes a new image into `runtime/outputs`.
- The package expects a Windows environment because the current launcher is `python.cmd`.
