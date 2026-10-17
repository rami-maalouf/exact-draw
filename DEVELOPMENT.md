# Developing Exact Draw

This guide covers running and changing Exact Draw. For the product's purpose and features, see the [README](README.md).

## Prerequisites

The native development workflow has been exercised on Apple Silicon macOS. The app targets macOS 14 or newer.

Install these before starting:

- **Xcode** for the native macOS build.
- **Rust through rustup.** Exact's setup command installs its declared toolchains and targets.
- **Bun 1.4.2**, the version used for the verified development workflow. Use Bun for dependency installation and scripts.
- **A Chromium browser** for browser tests. This app's E2E scripts default to Brave; set `CHROME` to another Chromium executable if needed.

Exact is young and changes frequently. The last recorded framework baseline for this app is `b0e24ded45`; compatibility with newer revisions must be checked. Consult the adjacent Exact checkout's README for its current platform prerequisites.

## First run

Clone the app and framework beside each other. Skip either clone if that checkout already exists:

```sh
git clone https://github.com/ccheever/exact2.git
git clone https://github.com/rami-maalouf/exact-draw.git
cd exact2
bun scripts/exact.mjs setup
bun scripts/exact.mjs setup --check
cd ../exact-draw
bun install --frozen-lockfile
bun run start
```

The expected layout is:

```text
parent/
  exact2/
  exact-draw/
```

Run Exact's setup once before the first app build. It prepares the framework dependencies, toolchains, and pinned Hermes bundles. The first native build can take substantially longer than subsequent builds.

If Bun 1.4.2 is installed separately under `~/.bun-1.4.2`, select it before running the commands:

```sh
export PATH="$HOME/.bun-1.4.2/bin:$PATH"
bun --version
```

`bun run start` builds the bundled editor and service resources, starts the development file service on `127.0.0.1:47931`, builds the native bundle, and launches the app. Keep this development launcher running. Quitting the app stops its companion service.

## Standalone macOS app

Run `bun run package:macos` to build a self-contained `.app`; the command prints its path. Copy that bundle into `/Applications` and open it normally. It includes Bun, the bundled file service and scan worker, editor assets, fonts, and the app icon. It needs no source checkout, system Bun installation, or terminal launcher at runtime.

The native module starts the bundled service when no service is listening, waits for its readiness message, and terminates it when the session closes. A parent-process check also ends the helper after an unexpected app exit. Errors go to `~/Library/Logs/Exact Draw/service.log`. Saved workspace and recovery data continue to live in `~/Library/Application Support/Exact Draw`.

The installed copy is independent of subsequent source builds. Rebuild and replace it to install an update. This is a local signed build; notarized public distribution is a separate step. Run the installed app or the development launcher one at a time because they share a service port.

In the app, choose **Open drawing** and select [`examples/Welcome.excalidraw`](examples/Welcome.excalidraw), or use **Add folder** to browse your own drawings. Only `.excalidraw` files are accepted.

## Development loop

Edit the relevant source, quit the app after its current drawing is saved, and run `bun run start` again to rebuild and relaunch.

For the browser preview, stop the native launcher first, then run:

```sh
bun run start:web
```

Open `http://127.0.0.1:8765`. The browser preview can browse saved workspace folders and recent drawings. Selecting new filesystem locations uses the macOS picker and remains a native-app operation. Both launchers use the same service port and saved workspace, so run one at a time.

The app resolves Exact from `../exact2`; `EXACT2` can override that path. Prefer the adjacent layout when getting started.

## Project structure

| Location | Responsibility |
| --- | --- |
| `app.contract` | Native shell, sidebar, explorer, context menu, and embedded editor surface |
| `app.ts` | Exact data sources calling the local companion |
| `app.test.contract` | Shell connection and sidebar visibility checks |
| `app.json` | App identity and platform configuration |
| `macos/modules/FileChooser.swift` | Native file and folder selection |
| `editor/` | Official Excalidraw React editor, autosave, external refresh, and draft recovery |
| `service/` | Filesystem access, persistent workspace/history, discovery worker, file watching, and authenticated loopback API |
| `scripts/start.ts` | Development launcher for the service and app |
| `scripts/build-editor.ts` | Local editor and font bundling |
| `tests/` | Browser and shell E2E tests, plus the discovery benchmark |

The companion owns filesystem operations. The shell displays workspace state and sends user actions. The embedded editor owns the drawing interaction. Folder discovery runs in a worker and reads directory entries without parsing drawings until they are opened.

Read Exact's `docs/start-here.md` in the adjacent checkout before changing Contract code. Use `bun exact.mjs contract vocab <name>` to look up supported attributes. Do not hand-edit generated files such as `app.contract.d.ts`, `exact.mjs`, `rust-toolchain.toml`, or `.cargo/config.toml`.

## Canvas and shell appearance

The embedded editor publishes its rendered background and a readable control color scheme through the iframe message channel. `editor/appearance.ts` accounts for Excalidraw's dark-mode canvas filter; `app.contract` applies the result to the sidebar and title bar. Keep these synchronized when upgrading Excalidraw: `bun run build:editor` followed by `bun tests/appearance.e2e.ts` checks the full browser shell against composited canvas pixels. Stop the installed app first because this test needs port 47931.

## Keyboard shortcuts

Declare shortcuts for persistent shell buttons in `app.contract` using Exact's `aria-keyshortcuts` and `-exact-menu`. Commands inside closed popovers are not registered by that mechanism. The native module therefore owns the persistent File menu, while a separate `handleNativeMenu` resource forwards its events through the same editor save barrier as shell commands. Keep this resource independent of workspace polling so refreshes cannot cancel a pending native picker.

Command-W always means Close Drawing and is disabled without a drawing. Close Window remains available in the native File menu. Its shortcut is deliberately not reassigned based on polled state, which could otherwise close the window while an open command is completing.

The sidebar button declares `aria-keyshortcuts="Meta+b"` and `-exact-menu="view"`. Its label and tooltip follow the current visibility. New shortcuts should include a Contract interaction test and native verification with both the shell and embedded canvas focused.

## Checks and tests

From the app directory, compile Contract first to refresh its generated TypeScript declarations, then run the basic checks:

```sh
bun exact.mjs contract build app.contract --json
bun run check
```

`check` runs the filesystem/service tests, TypeScript checking, and Contract compilation. It does not run the E2E suites.

For E2E testing, choose a browser executable if Brave is not installed:

```sh
export CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

The shell suite copies the source into a temporary sibling project with its own app identity, dynamic service port, and state. It builds its native bundle and can run alongside the installed app:

```sh
bun tests/editor.e2e.ts
bun tests/lifecycle.e2e.ts
bun tests/shell.e2e.ts
```

The editor suite builds its own editor assets and tests real browser drawing gestures, autosave, external replacement, zoom preservation, draft/conflict recovery, incomplete writes, and switching away from a moved file. The shell suite uses an isolated temporary workspace and drives web and macOS through Exact's agent. It covers persisted folders, recent-file opening, search, simplified labels, and context-menu removal without closing the active drawing.

To measure discovery separately:

```sh
bun tests/discovery.bench.ts
```

The benchmark creates a temporary dataset of 5,000 drawings, ignored dependency files, and an unrelated sparse file. It checks that the active document remains available during scanning. Results go to `.exact/discovery-benchmark.json`; browser screenshots go to `.exact/screenshots/`. This synthetic benchmark does not establish iCloud or large-image performance.

### Exact's visual verification

`exact verify` builds the web shell, runs `app.test.contract`, and checks light/dark layouts at two sizes. This fixture gives it an isolated companion, identity, and state so the installed app can keep running:

```sh
bun run build:editor
bun - <<'JS'
import { createShellFixture } from './tests/shell-fixture';

const fixture = await createShellFixture();
try {
  await fixture.run(['exact.mjs', 'verify']);
} finally {
  await fixture.dispose();
}
JS
```

The fixture's `testLoopbackOrigins` exception allows the test runner's temporary browser origin. Keep it confined to test services. To retain screenshots under the fixture's `.exact/verify/`, pass `true` to `dispose` and use the printed fixture path.

## Local data and recovery

Normal launches store workspace state and recovery copies under `~/Library/Application Support/Exact Draw`:

- `workspace.json`: added folders and their expansion state.
- `recent.json`: recent location history. The UI filters this to drawing files; older folder history also supports workspace migration.
- `document-session.json`: the active and last closed drawing paths.
- `recovery/`: previous disk versions and preserved conflicting edits.
- `recovery/documents.sqlite`: stable document identities, complete revision snapshots, and interrupted-move records. SQLite uses WAL and synchronous FULL. The latest 50 revisions per drawing are retained; explicit checkpoints count toward this limit.
- `recovery/trash/`: drawings removed through the app. Trash is app-owned, separate from Finder Trash, and retained until restoration.

Drawing files remain at their original paths. Removing a workspace root does not delete its contents. The editor also keeps pending edits in a browser-local draft to survive quick reloads; large embedded images can exceed that storage quota, in which case the UI asks you to keep the window open until Saved.

Rename and Move retain the document ID and history. Save As and Duplicate create independent drawings with their own history. History captures initial opens, changed autosaves, observed external revisions, explicit checkpoints, and restores. Restoring adds a revision and preserves the replaced content within the retention limit. New, Save As, Move, and Trash restoration reject occupied destinations. In Recently Deleted, expand Restore to another location to enter a full `.excalidraw` path in an existing folder when the original location is missing or occupied.

Recent locations and reopen state are secondary to completed filesystem changes. If their persistence fails, the canvas follows the completed action and the shell reports a warning that a restart may reopen older locations. The warning clears after a later successful lifecycle action.

The editor consumes shell file commands after flushing pending edits. If the current file has disappeared or a save cannot complete, opening another file or closing the drawing first preserves unsaved content in a recovery copy. Operations that change the existing file require resolving its save warning.

## Current technical limits

- Stable identity follows moves made through Exact Draw. Finder moves are not tracked automatically. History lives in this Mac's application data, not inside the portable drawing file.
- Full revision snapshots include embedded assets. Retention limits revision count, not total bytes. Trash has no automatic expiry or permanent-delete UI in this milestone.
- Exclusive publication requires hard-link support on the destination filesystem. Move stages data on the destination volume, and interrupted transfers are reconciled on startup; unsupported filesystems fail without replacing an existing destination. Tests cover process interruption, not sudden-power-loss durability.
- The local build is unsandboxed. Saved paths are not security-scoped bookmarks; persistent sandbox access still needs qualification.
- iCloud placeholder downloads, coordinated cloud writes, Finder document associations, and very large image-heavy drawings are not yet qualified.
- Native shell interactions and embedded editor rendering have been verified. Browser drawing gestures are automated; native pointer drawing still needs a dedicated manual verification pass because the computer-use drag tool failed to target the window.
- Saves check a digest before atomic replacement. That protects the intended alternating-editor workflow, but a non-cooperating external writer can still race between the check and rename. Simultaneous editing is not a collaborative merge workflow.
- The web preview is a development surface. The current filesystem integration is built for macOS; do not infer mobile support from the framework's available targets.

Record framework friction, workarounds, and the evidence for fixes in the [Exact experience journal](docs/exact-experience.md). The [initial build plan](docs/build-plan.md) provides architectural background; current behavior is documented here and in the README.
