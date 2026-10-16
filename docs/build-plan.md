# Exact Draw

A macOS desktop editor for ordinary `.excalidraw` files. Exact owns the native shell and virtualized explorer. The official Excalidraw React component owns the canvas. A loopback-only Bun companion owns filesystem access. Directory traversal runs in a worker, reads directory entries only, skips dependency/build directories and symlinks, and never loads drawings until opened.

## Invariants

- Never read `.excalidraw.md` or unrelated file contents during discovery.
- Never replace a disk version the editor has not loaded. Preserve a recovery copy for interrupted/conflicting edits.
- Never replace the active canvas merely because discovery progresses.
- Recent locations survive process restarts. Missing paths produce an actionable error.
- External changes preserve the viewport. Incomplete external writes retain the last valid drawing and retry.
- Keep Exact-specific findings, evidence, and workarounds in `docs/exact-experience.md`.

## Implementation and evidence

1. File service: extension filtering, background discovery, history, digest-checked atomic saves, directory watchers plus active-file polling. Test against real temporary files, including atomic replacement and partial writes.
2. Embedded official editor: local bundled assets, autosave, external refresh, conflict recovery, viewport preservation. Exercise drawing and external edits through browser UI.
3. Exact shell: native path input, recent locations, expandable virtualized explorer and embedded canvas. Build and drive macOS with Exact's agent.
4. Verify integrated workflow, record limitations, commit the working result, and launch it.

The initial development launcher runs the companion alongside the native app. Self-contained app packaging and sandbox bookmarks require a later packaging step; do not describe a terminal-dependent build as a distributable application.
