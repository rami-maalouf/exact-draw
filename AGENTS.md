<!-- exact:begin (exact new writes this block; bun exact.mjs update rewrites it) -->
# exact-draw: an Exact app

`app.contract` is the view, `app.ts` its data module, `app.test.contract` its tests, `app.json`
the manifest. The app uses the exact2 checkout at `../exact2` by path (`EXACT2`
overrides it).

This file is already in your instructions. Start from the nearest pattern: `bun exact.mjs
pattern` lists them and `pattern <name>` writes one, tested. ../exact2/docs/start-here.md is the guide,
the only required reading (LLP 1115 D7). When a name is in question, `bun exact.mjs contract
vocab <name>` answers it (no name: the card, which ../exact2/docs/card.md holds too). Run
`bun exact.mjs verify` when the features work, and `verify ios` once at the end for an iPhone
app. `bun exact.mjs help` lists the verbs, and your own in app.json `"commands"`.
`bun ../exact2/scripts/exact.mjs setup --check` names what a native build lacks.
The authoring diary: `bun exact.mjs feedback status` says whether this project keeps one.
Generated, so don't edit: `exact.mjs`, `rust-toolchain.toml`, `.cargo/config.toml`,
`Cargo.toml`'s `[patch.crates-io]` and this block.
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
