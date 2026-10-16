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

## 009: folder context menus use the built-in native menu

Status: implemented and tested on web and macOS.

Workspace roots now use `contextPopover` with a shared menu. The row's `contextmenu` action sets the target folder before the menu opens, and the menu button removes workspace membership. Non-root rows have no folder menu. This needed no Swift code: Exact maps the same Contract declaration to a macOS menu and a web popover.

The shell E2E right-clicks a root and chooses Remove from workspace, then verifies that another root and the current drawing remain. The first native test returned a stale-build error instead of rebuilding automatically, despite `exact.mjs help mac` saying it would rebuild. Running `bun exact.mjs mac --bundle` explicitly resolved it, and both hosts passed.

## 010: collapse the sidebar without remounting the editor

Status: verified in the native app and covered by the web Contract test.

The sidebar is conditionally removed from layout instead of shrinking to a narrow rail. The editor stays in the same canvas container, and an absolutely positioned Sidebar button restores the explorer. Native interaction confirmed that the embedded frame stays mounted across both transitions and that the button renders above the web view. No native extension or framework workaround was needed. The existing web verification passed with these sidebar changes, including the hide and reopen assertions.

## 011: a compact explorer and portable sidebar icon

Status: implemented and visually checked on macOS; web light/dark verification passed.

The original explorer inherited centered button content and plain-list separators. Explicit `text-align="start"` and `list appearance="none"` let the app draw compact explorer rows while retaining virtualization. The redesigned sidebar uses smaller controls, a single-line recent list, hover feedback, and an active-document highlight. The floating reopen button now contains an icon and retains its accessible label.

Exact's documented portable symbol roles do not include a sidebar or folder icon; arbitrary SF Symbols would be blank on the web. A small shared Contract SVG component supplies consistent outline icons on both hosts without a native module. Native screenshot inspection confirmed these icons and the overlay above the embedded editor. This is a portable icon catalog gap, not a rendering failure.

Validation: eight service tests with 42 assertions, TypeScript and Contract checks, file/folder/context-menu shell tests on web and macOS, and web verification at two sizes in both color schemes with no findings. The user's existing drawing was reopened, and the native expanded and collapsed layouts were inspected.

## 012: a Finder-launchable bundle needs an app-owned service lifecycle

Status: installed in `/Applications/Exact Draw.app` and launched without the development launcher.

Copying the original bundle alone would leave the canvas disconnected because `scripts/start.ts` owned the file service. The standalone package now places Bun, bundled JavaScript for the service and scan worker, editor assets, and fonts in `Contents/Resources/server` through Exact's supported `host.macos.resources` mapping. The native module starts that helper on demand, waits for an explicit ready message, records startup errors, and terminates its own child on teardown. The helper also watches its parent's lifetime. The service accepts explicit resource paths so runtime reads do not depend on the source checkout.

Exact's manifest icons produced `AppIcon.icns` and the bundle's `CFBundleIconFile` entry. The existing logo also renders in the sidebar. The installed bundle measured 112 MB, including its runtime. Deep code-signature verification passed, the bundled Bun executable ran, and the installed app restored saved folders, completed worker discovery, and reopened the user's drawing. Both its executable and helper ran from `/Applications`; quitting removed both processes. Filesystem/service tests and shell flows passed on web and macOS.

Framework opportunity: the resource-copy and signing hooks work, but readiness, helper ownership, startup errors, and parent-exit handling are app code. A supported companion-service lifecycle would remove that integration work.

## 013: full-window content is supported, but hard to discover by intent

Status: implemented and visually verified on macOS in commits `5702345` and `285e5a9`; recorded retrospectively on 2026-10-16 against the baseline above.

Removing the gray native titlebar needed one existing Contract attribute: `viewport-fit="cover"` on the root. Exact's macOS `coverChrome()` maps it to AppKit full-size content, transparent titlebar, hidden title, and no separator when there is no window toolbar. No new Swift code or framework patch was needed. The sidebar could retain `padding-top="calc(env(safe-area-inset-top) + 12px)"` while the canvas filled its pane.

The first implementation still padded the canvas and painted the exposed strip white. That was my interpretation mistake: matching the bar's color did not give the drawing that space. Removing the canvas padding and background let the existing Excalidraw background-color and theme controls affect the full canvas. Native inspection confirmed a nonwhite background and dark mode reached the top, with the sidebar both visible and hidden.

Discovery took more investigation than the small change warranted. `contract vocab viewport-fit` reported a string property without values or macOS behavior. Looking up `safe-area-inset-top` treated it as an unknown tag or attribute; it did not point to CSS `env(...)`. The start guide and card did not surface this titlebar recipe, so I used examples and host source to establish the behavior.

Framework opportunity: make searches for "transparent titlebar", "remove gray bar", and "edge-to-edge canvas" lead to a tested macOS recipe. Have vocabulary lookup show accepted values, a minimal example, safe-area usage, and the native-toolbar caveat. The declarative capability itself is a strength worth preserving.

## 014: a full-size web guest still needs to avoid native window controls

Status: workaround visually verified in `285e5a9`; superseded by the app-owned header in `837a172`. This records the original integration cost, not the current layout prescription.

Once the canvas extended under the titlebar, hiding the sidebar put the embedded editor's upper-left menu under the macOS window buttons. Exact deliberately gives its macOS WebKit guest zero automatic safe-area insets because Contract already owns the iframe's frame. That avoids double padding, but I did not find a documented way to expose the native controls' occupied area to the guest while keeping its canvas full size.

The app temporarily passed `windowControls=1` in the editor URL, used native-picker availability as a native-host proxy, and moved only the guest's first menu column down 32 px. Its floating sidebar button moved to 48 px from the top on native. This worked in the inspected window, but used fixed geometry and an Excalidraw DOM selector. It was not qualified across fullscreen, all window sizes, or macOS versions. The later header change removed the query flag and guest menu override.

Framework opportunity: document an opt-in host-to-guest geometry channel, with updates when layout changes. Local rectangles for overlapping window controls would be more useful here than mandatory padding across the entire top edge. Keep iframe sizing under Contract's control; expose geometry so embedded applications can place their own controls.

Verification lesson: an iframe-exists assertion cannot establish that the guest loaded or that its controls are reachable. A supported fixture should wait for guest readiness and inspect sidebar-open and sidebar-hidden states, light/dark appearance, and a nonwhite canvas. Some blank captures in my first isolated preview came from missing editor assets and load timing in my fixture, not an established Exact renderer defect.

## 015: installation support exists; updating a specific installed app took manual work

Status: local `/Applications` replacement and relaunch verified for `285e5a9`; existing installer behavior confirmed from framework source afterward.

I built from the committed app snapshot because other work was changing the shared checkout. After packaging the companion and editor, I staged the new bundle, verified its signature, quit the installed app, preserved the old bundle, replaced it, and reopened the user's drawing. Snapshot isolation was workspace coordination, not an Exact limitation. I reused the standalone packaging from entry 012; the titlebar task did not implement that service lifecycle.

I missed Exact's existing `install` command during deployment. Its implementation targets `~/Applications`, copies the built bundle, registers it with Launch Services, and creates a CLI shim. It would be inaccurate to report that Exact has no installer. The inspected implementation removes the target before copying and does not expose the explicit `/Applications` destination, backup/rollback, or quit/relaunch flow used here.

Framework opportunity: improve discovery of the existing installer and extend it with destination selection and a recoverable update flow. Document how a scaffolded app's packaging command feeds installation, including bundled helpers. Repeated builds, a Bun PATH mismatch, and fixture mistakes also added friction in this session; no reliable total engineering-time measurement was kept.

## 016: the tracked feedback diary needs a direct agent entry point

Status: documentation gap observed and corrected in the app's `AGENTS.md` on 2026-10-16.

The README and build plan linked this journal, but the agent instructions only pointed to `exact.mjs feedback status`. That command describes a separate gitignored `.exact/diary/` submission workflow. A future session could follow those instructions without finding this durable project history. I had read the journal during the feedback discussion but had not yet written this session's findings into it.

The project-owned section of `AGENTS.md` now directs agents to read and maintain this journal, distinguish evidence from interpretation, and mark superseded approaches. The generated Exact block remains unchanged.

Framework opportunity: let projects register a tracked experience journal and have `feedback status` identify it alongside submission diaries. The two serve different audiences, but their relationship should be explicit so useful findings are not lost or duplicated.

## Canvas beneath title-bar controls (2026-10-16)

Status: verified on macOS against exact2 `b0e24ded45`; browser layout checks also pass.

The title and sidebar toggle now occupy an opaque, absolutely positioned header sized to its contents. The canvas fills its pane to the top and bottom; only the guest controls reserve the header's 32 px height. Excalidraw's desktop UI layer, mobile top bar, Library panel, and warning messages need separate treatment. The isolated browser test checks viewport coverage and control clearance at 1200, 760, and 390 px widths, plus Library and a real invalid-file warning. Native inspection confirmed the installed app's canvas behind the unused title-bar area and working sidebar toggle.

A cold-launch preview repeatedly displayed WebKit error -999 while a reload succeeded. Moving URL construction into the data module and changing overlay stacking did not resolve it. Keying the iframe by its editor-session URL did: subsequent preview and installed-app cold launches loaded the guest without a reload. A session/source replacement race is a hypothesis, not a source-confirmed framework diagnosis. Normal workspace refreshes keep the same URL and frame. A temporary comparison with the previous web runtime did not produce a working editor and was discarded; the installed build uses the normal packaged runtime.

Framework opportunity: add a sandboxed loopback iframe cold-launch fixture that covers changing session URLs and asserts guest readiness. Document how to retain a guest across ordinary state updates while replacing it for a new authenticated session.

## 017: declarative shortcuts reach the embedded canvas

Status: verified in the installed macOS app on exact2 `b0e24ded45`.

The sidebar toggle uses `aria-keyshortcuts="Meta+b"` and `-exact-menu="view"` on its existing action button. Exact supplies keyboard dispatch and the native View menu; the app supplies the changing Show/Hide label and shortcut tooltip. No separate keyboard listener, native module, or editor bridge was needed.

Verification: Command-B hid and restored the sidebar with the native search field initially focused, then with the embedded drawing canvas focused. Canvas focus remained in the guest after both toggles. Clicking View > Hide sidebar invoked the same action. The Contract test also exercises both shortcut directions, and `exact verify` passed light/dark layouts at both configured sizes.

Preserve this capability: one declaration connects the accessible control, keyboard command, and native menu even with a WebKit guest focused. Improve discoverability by including this embedded-editor case alongside the shortcut documentation and testing it as a framework regression case.

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

Still unqualified: iCloud placeholders/coordinated writes, sandbox bookmarks, very large image drawings, notarized public distribution. Finder launch with the bundled service is now verified locally. Browser-level gestures do not by themselves prove macOS WebKit input behavior.

## 018: file commands must cross the shell/editor boundary before touching disk

Status: implemented against exact2 `b0e24ded45`; browser lifecycle and recovery flows, service tests, and web/macOS shell Contract flows verified on 2026-10-16.

The shell exposes a Drawing popover while the sidebar is hidden; persistent native File commands require the module workaround in entry 020. NSSavePanel fits the existing native module interface for New, Save As, and Move destinations. The official Excalidraw guest supplies the history dialog and SVG previews, so inspecting an old version never changes the live canvas.

A shell action cannot safely move or replace the active file immediately: the guest may still have a pending autosave. The app now queues a command in its local service; the guest consumes it, flushes pending edits, then performs the version-checked filesystem operation. A browser test draws and immediately renames, confirming that the renamed file contains the new shape. Another reproduced a blocked open after an external deletion. Navigation now preserves unsaved content in a recovery file before leaving an unavailable or conflicting drawing. Both clean and dirty missing-file navigation are covered separately from the existing conflict tests.

The durable store is app code, not an Exact feature. SQLite stores stable IDs, complete revision bytes, and interrupted-transfer records. App-initiated moves keep identity and history, copies start independent histories, and restore adds a recoverable revision. Tests cover retention of 50 revisions, occupied destinations, stale versions, restart persistence, and interrupted moves with external replacements. Finder moves are not identity-tracked; full snapshots can consume substantial space with embedded images. Sudden power loss and cloud coordination remain unqualified.

Framework opportunity: provide a documented shell-to-guest command/acknowledgement recipe with readiness, cancellation, and a before-document-change save barrier. The existing native module and menu primitives are sufficient; lifecycle ownership and safe guest coordination currently need an app-specific protocol.

## 019: shell tests need their own service and application identity

Status: isolated web and macOS Contract shell workflows pass; native standalone qualification recorded separately below.

The previous shell test required port 47931, which was occupied by the user's running installed app. Stopping that app or reusing its service would interfere with real drawings. The test now copies the source into a sibling fixture, uses a dynamic port and temporary state, and assigns a distinct native app identity. It builds its own standalone resources and retains an optional fixture for inspection. The existing app and shared checkout stay untouched.

The native runner's pointer tap on the header sidebar toggle did not change state in this fixture, while the declared Command-B shortcut did and the Drawing popover remained reachable. A subsequent native accessibility click toggled the sidebar correctly. The automated test records shortcut behavior; the runner result does not establish a product pointer defect.

Framework opportunity: support fixture overrides for app identity, companion-service endpoint, and state directory as part of test/verify. Today those values require a copied source fixture. Preserve the ability to drive the same Contract assertions on web and macOS, but report native input targeting failures with the target bounds and hit-test result.

## 020: native File commands need stable lifetime and guest delivery

Status: manually verified in an isolated standalone macOS bundle on 2026-10-16, with its own service on port 49689 and temporary state. The installed app on port 47931 was left running.

Declarative `-exact-menu` actions inside a closed popover did not appear in the native File menu. The app now registers persistent File items through its Swift module. A `native.watch('file-menu')` resource forwards actions into the local service queue. Initially that listener lived in the polling workspace source; refreshing the source canceled long-lived picker replies. Giving the menu listener its own stable resource fixed this. Save As remained open through several workspace refreshes and completed successfully.

Custom SSE command events did not reach the embedded guest in this native fixture even though the service accepted the command. The editor now also drains the command queue every second. A browser regression test suppresses the custom command listener and verifies delivery through this fallback. Buffering along the native embedding path is a hypothesis, not an established cause. Commands pause while a history, rename, or Trash dialog is open so another native action cannot discard unfinished dialog input.

Final native testing also reproduced Command-O opening Exact's developer Open Project dialog instead of the drawing chooser. Source inspection confirmed a duplicate equivalent in the Develop menu. Exact's own shortcut controller clears competing equivalents before assigning app shortcuts because AppKit caches them. The app module now follows that pattern across the whole menu tree and restores displaced bindings on teardown. Command-W remains assigned to Close Drawing, including while that action is disabled, so polled document state cannot change it into Close Window.

The final isolated bundle on port 50528 passed native Command-O/New/Save As chooser invocation and cancellation, Close Drawing, and a second Command-W with an empty canvas that kept the window open. The same source passed web/macOS shell tests and Exact verify at 390x844 and 1280x900 in light/dark appearances, including relaunch, without findings.

Native qualification covered Save As from a focused guest, Close Drawing, Reopen Closed Drawing, version preview, explicit checkpoint, restoration as a new revision, Move through NSSavePanel, Rename, Trash confirmation, and Recently Deleted restoration with history intact. Command-N's native destination chooser was also inspected. Browser automation additionally covers immediate rename after drawing, conflicting destination rejection, and restoring Trash to an alternate full path when its original destination is occupied. The alternate path form requires an existing parent folder; it does not yet open a native destination picker. OS chooser interactions are manually qualified, not automated by the current Exact runner. Native pointer drawing remains separately unqualified.

An early fixture launched from Documents stalled before the helper's readiness message, with no error in its log. The same bundled helper worked from the command line. Copying the preview bundle and its state into a system temporary directory allowed standalone launch. Protected-folder access is a possible explanation; this did not establish a TCC defect. The helper now supports this isolated preview layout.

Framework feedback: register menu commands independently of view visibility; document resource cancellation semantics for native sheets; provide a shell-to-guest command completion channel and an automated native menu/chooser driver. These are concrete gaps encountered with this baseline, rather than evidence that Exact supplies document storage or history itself.

## 021: completed disk changes must remain authoritative during recovery

Status: failure-injection tests pass for app-owned storage and secondary state persistence.

Review found two interruption cases worth preserving in tests. A source edited in place before a move completes must retain its identity when the staged destination is rolled back; an entirely different file recreated at that path must not take the moved document's identity. Transfer records now retain source device/inode to distinguish them. A failed SQLite registration after exclusive file creation removes only the unchanged file owned by that operation, allowing a safe same-path retry.

A case-only rename initially failed as an occupied destination on the local case-insensitive macOS volume. The browser test reproduced `Renamed` to `RENAMED` failing before the fix. Same-file canonical aliases now use a journaled native rename; separate hardlinks and other occupied targets remain protected. Tests cover identity/history retention and restart on either side of that rename.

Recent-location or reopen-state writes can fail after a move or Trash operation has already committed. The service now updates the active document and notifies the guest before attempting those secondary writes. It reports persistence failures as a shell warning while returning the completed action successfully. Tests inject both write failures, verify active identity and Trash state, and confirm later persistence recovery. These are app-level design lessons, not Exact framework defects.
