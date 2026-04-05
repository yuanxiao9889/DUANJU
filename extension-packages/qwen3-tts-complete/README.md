# Qwen3 TTS Complete

This folder is the full offline Qwen3 TTS extension package that can be loaded directly by Storyboard Copilot.

It already includes:

- `runtime/python`
- `runtime/app/qwen_tts`
- `runtime/app/storyboard_qwen_runner.py`
- `runtime/models/Qwen3-TTS-12Hz-1.7B-Base`
- `runtime/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign`
- `runtime/models/Qwen3-TTS-12Hz-1.7B-CustomVoice`
- `runtime/models/Qwen3-TTS-Tokenizer-12Hz`

## Direct use

Load this folder in Extensions Center:

- `E:\Storyboard-Copilot\extension-packages\qwen3-tts-complete`

After the extension is enabled, the current app build unlocks:

- `ttsTextNode`
- `ttsVoiceDesignNode`
- `ttsPresetVoiceNode`
- `ttsSavedVoiceNode`

## Notes

- This is a full offline package and is expected to be large because it contains the local Python runtime and model assets.
- The template source used to rebuild this package is stored separately in:
  - `E:\Storyboard-Copilot\extension-packages\qwen3-tts-complete-template`

## Hardware notes

- Recommended: an NVIDIA GPU with CUDA support.
- Qwen3-TTS officially recommends FlashAttention 2 to reduce GPU memory usage.
- FlashAttention's official CUDA support notes currently focus on NVIDIA Ampere / Ada / Hopper GPUs; `bf16` also requires Ampere / Ada / Hopper.
- The package can still fall back to CPU in the current integration, but offline 1.7B generation will usually be much slower without a compatible GPU.
- The official Qwen3-TTS README does not publish a fixed minimum VRAM number, so actual comfort depends on GPU architecture, available VRAM, sampling params, and text length.

## Quick checks

Health check:

```powershell
E:\Storyboard-Copilot\extension-packages\qwen3-tts-complete\runtime\python\python.exe `
  E:\Storyboard-Copilot\extension-packages\qwen3-tts-complete\runtime\app\storyboard_qwen_runner.py `
  --command health
```

Model list:

```powershell
E:\Storyboard-Copilot\extension-packages\qwen3-tts-complete\runtime\python\python.exe `
  E:\Storyboard-Copilot\extension-packages\qwen3-tts-complete\runtime\app\storyboard_qwen_runner.py `
  --command list_models
```
