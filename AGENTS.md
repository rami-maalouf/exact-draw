<!-- exact:begin (exact new writes this block; bun exact.mjs update rewrites it) -->
# exact-draw: an Exact app

`app.contract` is the view, `app.ts` its data module, `app.test.contract` its tests, `app.json`
the manifest: set its `app.name` and `app.id` before the first build. The app uses the exact2
checkout at `../expo-exact` by path (`EXACT2` overrides it).

This file is already in your instructions. Start from the nearest pattern: `bun exact.mjs
pattern` lists them and `pattern <name>` writes one, tested. ../expo-exact/docs/start-here-site.md (a site) or
../expo-exact/docs/start-here.md is the only required reading. `bun exact.mjs contract vocab <name>` answers a
name (none: the card); `bun exact.mjs docs <heading words>` a guide's
section. Run `bun exact.mjs verify` when the features work, and `verify ios|android` at the end for a
phone app. When an iPhone app is ready for the person to try, run `bun exact.mjs share` and give
them the link it prints; run it again after each change they should see. `bun exact.mjs help` lists the verbs, and your own in app.json `"commands"`.
`bun exact.mjs update` refreshes files. `bun exact.mjs lock` repairs Cargo lock drift.
`bun exact.mjs update --without linux` stops shipping Linux.
`bun ../expo-exact/scripts/exact.mjs setup --check` names what a native build lacks.
Shared data: `exact new <path> --snapback`, or `bun exact.mjs snapback` here.
Install `snapback4@0.4.33` above; ../expo-exact/snapback4/README.md has setup and server commands.

Generated, so don't edit: `exact.mjs`, `rust-toolchain.toml`, `.cargo/config.toml`,
`Cargo.toml`'s `[patch.crates-io]` and this block.

## Feedback (required)

When a doc was wrong or missing, a workaround was needed, something took several tries or a
command confused you, record it: `bun exact.mjs feedback note "<what happened>"`. It attaches
exact2's commit and the last exit code, never output or code. `bun exact.mjs feedback status` says
whether notes are sent and whether to keep a diary; under `never`, skip all of this.
<!-- exact:end -->

## Exact framework feedback diary

- Read [docs/exact-experience.md](docs/exact-experience.md) before working on Exact integration, native behavior, packaging, or framework feedback. This is the project's shared, versioned record of what worked, what was difficult, and what would improve Exact.
- Add meaningful findings as you work. Record what you tried, the observed result, the solution or workaround, and a concrete framework improvement. Include successful capabilities worth preserving, not only problems. Extend an existing entry when it covers the same finding.
- Separate reproduced behavior, source-confirmed limitations, hypotheses, and agent mistakes. Name the platform and relevant revision; state what was actually verified. Label superseded workarounds so historical entries are not mistaken for current implementation advice. Do not invent timings or infer native success from browser tests.
- Exact's `.exact/diary/` and `feedback` command are a separate submission workflow; they do not replace this tracked diary. Updating this document does not authorize sending feedback externally.

## Git workflow

- Work directly on `main` and push there unless explicitly asked to use a branch or pull request.
- Fetch and rebase onto `origin/main` before pushing when the remote has advanced.
- Never create merge commits. If a pull request is requested, merge it using rebase.
