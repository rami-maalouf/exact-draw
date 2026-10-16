# Building Exact Draw with Exact

Baseline: exact2 `b0e24ded45`. Record observed failures separately from source-based limitations. Never infer native success from a web build.

## 001: filesystem ownership is an integration boundary

Status: source-confirmed limitation; workaround being implemented.

The app needs arbitrary user-selected paths, recent locations across launches, active-document watching, and background folder discovery. Exact's documented selected-folder permissions are session-only. Tamber's watcher is development tooling for `.tamber` files, not an app-facing watcher.

Decision: use a local Bun companion with a worker for directory traversal. The native shell and embedded editor share that service. This first build is unsandboxed development software; its recent paths do not demonstrate sandbox bookmark support.

Framework opportunity: an app-facing directory iterator, file observation stream, and persistable document handles with explicit macOS/iCloud semantics.

## 002: embedding a real web application needs an asset host

Status: source-confirmed limitation; native verification pending.

Exact's local iframe srcdoc path documents that multi-file subresources do not resolve. Excalidraw needs JavaScript, CSS, fonts and asynchronous chunks.

Decision: bundle those locally and serve them on loopback. No CDN is needed for the editor to load. Keep the Contract shell native.

Framework opportunity: a supported bundled-web-app origin with subresources, documented lifecycle, and production packaging.

## 003: updating Exact also changes build prerequisites

Status: observed during `exact new`.

The scaffold succeeded but setup reported a new uncached Hermes v5 bundle, missing Chrome, and game SDK crate cache entries. Existing earlier Exact builds were not enough for this revision. Re-ran `bun scripts/exact.mjs setup`; host and iOS Hermes bundles installed successfully. Native/browser qualification still pending.

Framework opportunity: distinguish prerequisites needed for the chosen app/host from optional game and other-platform dependencies in the first-run diagnostic.
