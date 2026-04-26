# VoxCPM2 Complete Template

This template is the source scaffold for the packaged Storyboard Copilot
VoxCPM2 offline extension.

It is used by `npm run prepare:voxcpm2-extension` to assemble a portable
extension folder that bundles:

- the Storyboard Copilot Python bridge runner
- a portable Python runtime
- a local VoxCPM2 model snapshot

The assembled output is written to:

- `E:\Storyboard-Copilot\build\extensions\voxcpm2-complete`

The current package layout targets the upstream `OpenBMB/VoxCPM` project with
the local runtime verified against `voxcpm 2.0.2`.
