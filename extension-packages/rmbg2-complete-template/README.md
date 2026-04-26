# RMBG-2.0 Complete Template

This template assembles the `rmbg2-complete` Python-bridge extension package for Storyboard Copilot.

## Intended use

- Internal evaluation and non-commercial validation only.
- Single-image background removal that writes a transparent PNG result.
- GPU PyTorch runtime only. No CPU fallback is packaged in this first version.

## Package layout

- `storyboard-extension.json`: manifest consumed by Extensions Center.
- `runtime/app/storyboard_rmbg_runner.py`: persistent runner that exposes `health`, `list_models`, `warmup`, `remove_background`, and `shutdown`.
- `runtime/models/RMBG-2.0`: local model snapshot copied or downloaded by the assembly script.
- `runtime/outputs`: generated PNG files.
- `runtime/cache`: model download and runtime cache.

## Assembly

Run:

```bash
npm run prepare:rmbg2-extension
```

Default behavior:

- Reuses the portable Python runtime copied from `extension-packages/qwen3-tts-complete/runtime/python`
- Downloads the model from ModelScope `AI-ModelScope/RMBG-2.0`
- Keeps Hugging Face `briaai/RMBG-2.0` as a fallback source

You can also point to an already-downloaded model snapshot:

```bash
node scripts/prepare-rmbg2-extension.mjs --model-source C:\path\to\RMBG-2.0
```

## License note

RMBG-2.0 is source-available upstream, but the upstream model card and repository describe it as non-commercial use. Keep this extension out of default commercial packaging unless the license situation is re-evaluated.
