# Building Exact Draw with Exact

Baseline: exact2 `b0e24ded45`. Record observed failures separately from source-based limitations. Never infer native success from a web build.

## 001: filesystem ownership is an integration boundary

Status: source-confirmed limitation; companion implemented and tested.

The app needs arbitrary user-selected paths, recent locations across launches, active-document watching, and background folder discovery. Exact's documented selected-folder permissions are session-only. Tamber's watcher is development tooling for `.tamber` files, not an app-facing watcher.

Decision: use a local Bun companion with a worker for directory traversal. The native shell and embedded editor share that service. This first build is unsandboxed development software; its recent paths do not demonstrate sandbox bookmark support.

Framework opportunity: an app-facing directory iterator, file observation stream, and persistable document handles with explicit macOS/iCloud semantics.

## 002: embedding a real web application needs an asset host

Status: source-confirmed limitation; native guest rendering verified.

Exact's local iframe srcdoc path documents that multi-file subresources do not resolve. Excalidraw needs JavaScript, CSS, fonts and asynchronous chunks.

Decision: bundle those locally and serve them on loopback. No CDN is needed for the editor to load. Keep the Contract shell native.

Framework opportunity: a supported bundled-web-app origin with subresources, documented lifecycle, and production packaging.

## 003: updating Exact also changes build prerequisites

Status: observed during `exact new`.

The scaffold succeeded but setup reported a new uncached Hermes v5 bundle, missing Chrome, and game SDK crate cache entries. Existing earlier Exact builds were not enough for this revision. Re-ran `bun scripts/exact.mjs setup`; host and iOS Hermes bundles installed successfully. Native/browser shell qualification subsequently passed.

Bun must also be on PATH at the required version, not only invoked by absolute path: `bun run` package scripts can otherwise find the older system Bun. The documented launcher command prepends the pinned Bun directory.

Framework opportunity: distinguish prerequisites needed for the chosen app/host from optional game and other-platform dependencies in the first-run diagnostic.

## 004: browser and native iframe origins differ

Status: reproduced and resolved in the app.

The web shell initially could not connect because the Exact agent serves its page on a dynamic loopback port. The service had admitted only the fixed development port. The isolated test harness explicitly permits dynamic loopback origins. The actual app permits only its own origin, plus the explicitly configured web development origin when running in web mode. Other local web apps cannot retrieve the session token by default.

Native shell tests then passed while the embedded editor displayed `Local access only.` Exact wraps native iframe content under a synthetic `https://exact.invalid` origin, making its initial navigation cross-site. The service now permits the token-authenticated editor navigation and retains the API origin/authentication checks.

Lesson: a shell test that only asserts an iframe exists is insufficient. Inspect the guest tree and screenshot. An official embedded local-service example covering the native wrapper origin and web agent port would have saved discovery time. These were integration mistakes in this app, not demonstrated Exact security defects.

## 005: Contract compiler feedback was specific and useful

Status: observed and resolved.

The first shell compilation rejected `-exact-caption`, named the valid `-exact-caption1`/`-exact-caption2` styles, and explained that native buttons cannot contain arbitrary row/column faces. It also warned about `1 drawings`. One correction pass produced `[]` diagnostics. Custom explorer faces use `appearance="none"`; ordinary controls remain native.

The first test used `size 1280 820`; the parser named the required `1280x820` form. Corrected the test syntax.

Lean in: actionable diagnostics, generated source types, and the same Contract interaction test on web and macOS are genuinely useful for this app.

## 006: real desktop launch needs the bundle flag

Status: observed; development launcher updated.

`exact.mjs mac --run` runs the native executable and presents its window, but the computer-use app inventory did not identify it as a normal installed application. `mac --bundle --run` assembles the `.app` but still runs the plain executable. The development launcher now builds the bundle, resolves its location through Exact's artifact helper, and runs its `Contents/MacOS` executable. The app can then be addressed by its bundle path.

The native accessibility tree exposed the full embedded Excalidraw controls, and selecting the rectangle tool changed the selected state. After restarting the service/app, a recent file reopened through the native sidebar. An external file write added a green rectangle, which appeared in the native canvas without reloading; opening its folder then populated the explorer while keeping the rectangle visible.

The computer-use coordinate drag API repeatedly returned `noWindowsAvailable`, including after raising the window. This is an automation limitation of this session, not evidence that native drawing is broken or proven working. Browser pointer gestures are verified; native pointer drawing remains a manual qualification item.

Remaining product work: bundle/start the file companion with the native application so Finder launch is sufficient. Do not confuse an assembled `.app` with a complete distributable product.

## 007: native pickers exist, but document handles are not companion paths

Status: source-confirmed integration boundary; native selection verified.

The initial UI had only a path field. Exact provides `showOpenFilePicker` and `showDirectoryPicker`, implemented with native panels, but returns session-local `doc:/` handles. Its documented document API refuses `realpath`; these handles cannot be passed directly to a separate Bun process or persisted as recent filesystem paths.

The app now uses Exact's supported `native.later` interface and a small macOS Swift module to show `NSOpenPanel` and return the selected path. File selection filters and validates `.excalidraw`; folder selection calls the existing worker discovery. Cancel returns without opening anything. This is specific to the current unsandboxed development architecture and does not establish cross-process sandbox access.

Verified in the real native UI: open a drawing through the chooser, open its folder while keeping the canvas, cancel without changing the current drawing. The module built through the normal Exact build. One Swift compile correction was needed: the panel delegate must inherit NSObject, so it is a separate helper rather than the ExactModule subclass. That was app integration work, not an Exact defect.

Framework opportunity: a documented way to hand a user-selected document to an app-owned background service, including persistent access and sandbox scope, would make this architecture easier to support.

## 008: workspace persistence belongs outside recent history

Status: implemented and covered by restart tests.

The first service remembered recent locations but did not restore explorer roots. The workspace now persists all selected folders and their expansion state in `workspace.json`, independently of the capped recent list. The initial upgrade imports previously selected folders from that history. One worker scans all roots on startup. Unavailable and empty folders remain visible until explicitly removed; removal never touches drawing files.

The path-entry field was removed in favor of the native selectors. The web preview can browse existing workspace roots and recent files; selecting new filesystem locations remains a macOS operation.

The revised shell test exposed an Exact agent targeting issue: a raw path in a test ID such as `recent-/…/First.excalidraw` was interpreted as a view/part target when tapped. Encoding path components in IDs resolved it while retaining the real path as the accessibility label. This was an app naming mistake exposed by stronger interaction coverage, not a filesystem failure.

Validation: eight filesystem/service tests (42 assertions), TypeScript and Contract checks, restored-workspace shell tests on web and macOS, and `exact verify` on web with no findings in 5.6 seconds. A real macOS relaunch restored the previously selected folders without input and showed no path field; the previously open drawing was reopened through recent history.

## Measured commands and qualification

Exact's `.exact/commands.jsonl` records timestamps, revision, exit and elapsed milliseconds automatically. These are command durations, not total engineering time:

| Command | Observed elapsed |
| --- | ---: |
| First `contract vocab` invocation | 15.276 s |
| First macOS build in this new app | 40.052 s |
| First web build | 25.767 s |
| Subsequent explicit macOS builds | 4.098-5.911 s |
| Passing web shell connection test | 2.012 s |
| Passing macOS shell connection test | 2.374 s |
| Full file/recent/folder shell test, web | 2.866 s |
| Full file/recent/folder shell test, macOS including stale rebuild | 7.033 s |

Existing machine caches materially helped. These are not cold-machine setup estimates.

Verified: TypeScript check; seven real-filesystem/service tests; browser canvas gesture autosave, external replacement followed by editing, zoom preservation, immediate reload recovery with saves blocked, lost-response reconciliation, dirty conflict recovery, incomplete JSON handling, and switching away from a moved dirty file; web and macOS Contract open/recent/folder/search workflow; native guest content and screenshots.

Independent review caught app-level coordination issues: scan warnings sharing the active-document error, a delayed read republishing an obsolete snapshot after a save, and a failed save preventing a dirty file switch. These were fixed and covered by service/browser regression tests. They are lessons for the integration, not framework bugs.

Synthetic local discovery benchmark: 5,000 drawings, 5,000 ignored dependency files, one unrelated 4 GiB sparse file; discovery 27 ms, 30 concurrent active-document requests, p95 0.19 ms and max 0.88 ms. The active drawing was preserved. This measures service responsiveness with warm local data, not native frame timing, cloud enumeration or downloading 4 GiB.

Still unqualified: iCloud placeholders/coordinated writes, sandbox bookmarks, very large image drawings, signed distribution, Finder-only launch. Browser-level gestures do not by themselves prove macOS WebKit input behavior.
