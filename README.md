<p align="center"><img src="assets/brand/logo.png" alt="Exact Draw logo" width="160" /></p>

# Exact Draw

A local macOS editor for `.excalidraw` files. Exact renders the desktop shell and explorer; the official Excalidraw component renders the canvas in Exact's WebKit surface.

## Run

Requires the adjacent `../exact2` checkout, Bun 1.4.2 or newer, and Exact's macOS build prerequisites. This implementation was verified against Exact `b0e24ded45`.

```sh
export PATH="$HOME/.bun-1.4.2/bin:$PATH"
bun install --frozen-lockfile
bun run start
```

The launcher builds local editor assets and the native `.app`, starts the loopback file service, and opens the window. Keep the launcher running. Closing the app stops the service. The `.app` alone is not yet self-contained: automatic companion startup from Finder remains packaging work.

On macOS, use **Open drawing…** or **Open folder…** to choose a location with the native system dialog. The drawing chooser accepts only `.excalidraw`; cancelling leaves the current drawing alone. There is no path-entry field. New locations are selected in the macOS app; the web preview can browse the saved workspace and recent files. Try `examples/Welcome.excalidraw`.

- Only ordinary `.excalidraw` files are supported. `.excalidraw.md` is excluded.
- The explorer scans directory entries in a worker, progressively, without reading drawing contents. It skips dependency/build directories and symlinks. Expand folders or search paths to find drawings.
- Folder discovery leaves the current drawing open. Use **Refresh** to rediscover newly added files; active-document changes refresh automatically.
- Every added folder stays in the workspace across app/service restarts, including empty or temporarily unavailable folders. Opening another folder adds it alongside the others. Expanded folders are remembered, and discovery resumes in the background on launch.
- Right-click a workspace folder and choose **Remove from workspace** to remove that explorer root. It does not delete or move files, and an open drawing stays open. Previously selected folders are migrated from recent history the first time this version starts.
- Hide the sidebar to give the drawing the full window width. The floating sidebar icon beside the canvas menu brings it back without reloading the editor. The explorer highlights the active drawing and uses compact folder and file rows, with recent drawings below. Recents shows files only, and drawing labels omit `.excalidraw`; actual filenames and paths are unchanged.
- Edits autosave after a short debounce. The canvas preserves zoom and position on external refresh.
- A stale save is refused. Conflicting local edits are preserved in a recovery file before choosing **Use disk version**.
- Pending edits also have a browser-local draft to survive a quick reload. Large embedded images can exceed browser storage quota; a warning tells you to keep the window open until Saved.

History and recovery copies are under `~/Library/Application Support/Exact Draw`. Previous disk versions are retained per opened file; conflict recoveries have unique filenames. All editor assets are local. Excalidraw website collaboration, hosted sharing and Obsidian plugin behavior are not implemented.

## Verification

```sh
bun run check
bun run build:editor
bun tests/editor.e2e.ts
bun tests/shell.e2e.ts
bun tests/discovery.bench.ts
```

The browser E2E uses Brave by default, or the Chromium executable named by `CHROME`. The shell suite starts an isolated service on port 47931, so close the development app first. It drives the same Contract test on web and macOS through `exact.mjs` / `scripts/agent.mjs`.

Tests cover browser drawing gestures and disk writes, external atomic replacement, zoom preservation, reload recovery with saves blocked, lost save responses, dirty conflict recovery, incomplete external JSON, switching away from moved files, stale-save refusal, extension filtering, dependency exclusion, recent history after service restart, and opening folders without replacing the active drawing. Screenshots and benchmark results go under `.exact/`. The editor test builds its assets before running.

## Design and current limits

- `app.contract`: native explorer and recent locations.
- `app.ts`: Exact data sources talking to the local companion.
- `macos/modules/FileChooser.swift`: native system file/folder selection through Exact's asynchronous module API.
- `editor/`: official React editor and autosave/refresh coordination.
- `service/`: filesystem ownership, history, active-file watching, worker discovery and authenticated loopback API.
- [Build plan](docs/build-plan.md), [Exact experience journal](docs/exact-experience.md).

This first development build is unsandboxed. Saved paths are not security-scoped bookmarks. iCloud placeholder downloads, coordinated cloud writes, sandbox access restoration, Finder document associations, and standalone distribution are not yet qualified. Directory discovery speed has been measured on a synthetic local dataset, not an iCloud vault. Very large image-heavy drawings also need separate profiling.

The macOS shell workflow and embedded editor rendering are verified. Native pointer drawing still needs a manual pass: the computer-use drag tool failed to target the window, while accessibility controls worked.

Digest checking immediately before atomic replacement protects the intended alternating-editor workflow. It is not an atomic compare-and-swap against an uncooperative simultaneous external writer; a tiny check-to-rename race remains. A previous-version recovery copy is retained. This app is not a collaborative merge engine.
