# OpenCLI Extension Notes

This project uses the local `opencli-extension` directory as the Chrome automation bridge.

## Added commands

The bundled `dist/background.js` now supports two extra actions that are useful for Jimeng automation:

- `download`
  - Starts a browser download from `http://`, `https://`, or `data:` URLs.
  - Optional fields:
    - `filename`
    - `saveAs`
    - `conflictAction`
    - `waitForComplete`
    - `timeoutMs`

- `downloads`
  - `op: "list"` lists recent downloads.
  - `op: "wait"` waits for a download to finish.
  - `op: "cancel"` cancels a running download.
  - `op: "erase"` removes a finished download record from Chrome history.

- `jimeng`
  - `op: "focus"` opens the Jimeng image or video workspace and focuses the automation tab.
  - `op: "inspect"` injects the Jimeng bridge and returns the live parameter panel report for `creationType: "image"` or `creationType: "video"`.
  - `op: "sync-draft"` applies payload values to the page without clicking submit.
  - `op: "submit"` applies payload values and clicks the Jimeng submit button.
  - `op: "generate-images"` submits the image workspace and waits for the new 4-image result group.
  - `op: "image-results"` polls the page for generated image cards, with baseline filtering so old results are ignored by default.
  - `op: "inspection-state"` / `op: "submission-state"` return the latest bridge state for richer orchestration.

The `jimeng` action loads `dist/jimeng_bridge.js`, which is the same DOM bridge logic used by the Tauri-side prototype in this repo.

## Jimeng-oriented usage

The extension already had the core primitives needed for Jimeng page automation:

- `navigate`
- `tabs`
- `exec`
- `set-file-input`
- `screenshot`

With the added download commands, a Jimeng automation flow can now:

1. Open the Jimeng workspace in an isolated automation window.
2. Inspect image/video parameter panels through `jimeng` `inspect`.
3. Manipulate the page through `jimeng` `sync-draft` / `submit` or low-level `exec`.
4. Upload references through `set-file-input`.
5. Wait for image results and download assets through `jimeng` `image-results`, `download`, and `downloads`.
