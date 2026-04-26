This directory is auto-managed by `npm run prepare:portable-git`.

Build flow:

1. Query the latest official Git for Windows release.
2. Download the `PortableGit-*-64-bit.7z.exe` asset.
3. Silently extract it here before `tauri build`.

The app will prefer this bundled runtime and fall back to a system Git installation only when the bundled runtime is unavailable.
