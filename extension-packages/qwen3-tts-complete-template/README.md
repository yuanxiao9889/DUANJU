# Qwen3 TTS Complete

This is the real offline Qwen3 TTS extension package source for Storyboard Copilot.

It is designed for Phase A of the integration plan:

- reuse the local integrated Qwen3-TTS bundle
- remove the Gradio-centric startup path
- add a Storyboard-specific Python bridge runner
- assemble a loadable package for the Extensions Center

## Source package vs assembled package

This folder is the source template.

The actual runtime-heavy package should be assembled into:

- `build/extensions/qwen3-tts-complete`

Use:

```bash
npm run prepare:qwen3-tts-extension
```

By default the build script uses directory junctions on Windows so the 20GB-class runtime assets are not duplicated during early integration work.

Load this assembled folder in Extensions Center:

- `E:\Storyboard-Copilot\build\extensions\qwen3-tts-complete`

## What the assembled package includes

- `runtime/python`
- `runtime/app/qwen_tts`
- `runtime/app/storyboard_qwen_runner.py`
- `runtime/models/Qwen3-TTS-12Hz-1.7B-Base`
- `runtime/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign`
- `runtime/models/Qwen3-TTS-12Hz-1.7B-CustomVoice`
- `runtime/models/Qwen3-TTS-Tokenizer-12Hz`

## Current scope

This package source is ready for:

- package assembly
- runtime health checks
- future Tauri bridge integration

The canvas currently exposes the first two TTS nodes:

- `ttsTextNode`
- `ttsVoiceDesignNode`

The later nodes for custom voice and voice clone will be wired in after the real runtime bridge is connected to the app.

## Smoke test

Health check:

```powershell
E:\Storyboard-Copilot\build\extensions\qwen3-tts-complete\runtime\python\python.exe `
  E:\Storyboard-Copilot\build\extensions\qwen3-tts-complete\runtime\app\storyboard_qwen_runner.py `
  --command health
```

Voice design test:

```powershell
E:\Storyboard-Copilot\build\extensions\qwen3-tts-complete\runtime\python\python.exe `
  E:\Storyboard-Copilot\build\extensions\qwen3-tts-complete\runtime\app\storyboard_qwen_runner.py `
  --request-file E:\Storyboard-Copilot\build\extensions\qwen3-tts-complete\runtime\app\smoke-request.json
```
