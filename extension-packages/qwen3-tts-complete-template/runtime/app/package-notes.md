# Runtime Notes

This directory contains the Storyboard-specific runtime bridge for Qwen3 TTS.

Key rules:

- Do not start the official Gradio demo from the app runtime.
- Use `storyboard_qwen_runner.py` as the only process entrypoint.
- Keep `qwen_tts` importable from the same runtime package folder.
- Save generated wav files into `../outputs`.
- Save reusable clone prompt files into `../voices`.
