# Qwen3 TTS Simple

This is a first-pass extension package for Storyboard Copilot.

It is designed to prove the full extension workflow:

- load a folder in Extensions Center
- enable the package with visible startup progress
- unlock the `TTS Text` and `Voice Design` canvas nodes
- generate a mock WAV output and create an audio node

This package uses a mock runtime for now so the end-to-end flow can be verified before integrating the real Qwen3 TTS runtime.
