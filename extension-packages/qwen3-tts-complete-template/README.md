# Qwen3 TTS Complete Template

This folder is the lightweight source template used to assemble the full offline Qwen3 TTS extension package.

It is not the package you should load in Extensions Center.

The full testable package is:

- `E:\Storyboard-Copilot\extension-packages\qwen3-tts-complete`

To rebuild from the local integrated bundle, run:

```bash
npm run prepare:qwen3-tts-extension
```

The build script uses this template and copies the local runtime and model assets from the integrated Qwen bundle into a full package directory.
