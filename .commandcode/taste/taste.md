# Taste

- The `actual-budget-importer` project uses pnpm as its package manager (pnpm-workspace.yaml, pnpm patch/patch-commit, pnpm test/typecheck) — default to pnpm for all dependency operations there. Confidence: 0.9
- It is a Node.js/TypeScript project (`src/*.ts`, `package.json`, typecheck step). Confidence: 0.85
- User answers clarification questions tersely, typically pasting only a short identifier of the relevant item (filename, correspondent, date — e.g. "this one EXTRATO COMBINADO 2026009.pdf / ActivoBank · activobank · 2026-09-30"). Resolve such fragments via your own lookups (DB/files) instead of asking follow-up questions. Confidence: 0.5
- For non-trivial feature requests, the user prefers you enter plan mode and produce a written plan before implementing — they'll say "plan it" explicitly rather than wanting immediate code changes. Confidence: 0.6
- When a change can only be fully verified by running the app/UI, the user expects you to do that yourself (boot the dev server, drive a real browser, smoke-test the endpoints) instead of handing back a list of manual verification steps — they'll reply "you run it for me". Don't defer interactive verification to the user. Confidence: 0.75
