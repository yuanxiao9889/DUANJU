# VoxCPM2 Complete

This folder is the offline VoxCPM2 extension template for Storyboard Copilot.

It is assembled into a loadable extension package by:

```powershell
npm run prepare:voxcpm2-extension
```

The build script will:

1. Copy this template into `build/extensions/voxcpm2-complete`
2. Reuse a portable Python runtime
3. Install `voxcpm[cuda12]`
4. Download `OpenBMB/VoxCPM2` into `runtime/models/VoxCPM2`

## Default runtime source

By default the build reuses the existing portable runtime at:

- `E:\Storyboard-Copilot\extension-packages\qwen3-tts-complete\runtime\python`

Override it when needed:

```powershell
npm run prepare:voxcpm2-extension -- --runtime-source D:\portable-python
```

## Model source

Default model download source:

- ModelScope repo: `OpenBMB/VoxCPM2`

You can also reuse a local snapshot:

```powershell
npm run prepare:voxcpm2-extension -- --model-source D:\models\VoxCPM2
```

## Result

After assembly, load this folder in Extensions Center:

- `E:\Storyboard-Copilot\build\extensions\voxcpm2-complete`
