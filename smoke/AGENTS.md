# Smoke test conventions

- Use `smoque` for shallow checks of the committed action artifact.
- Prefer `t.cmd()` with explicit arguments and `t.tempDir()` for owned files.
- Keep smoke tests offline and deterministic; live distribution coverage belongs
  in the GitHub integration matrix.
- Expected failures must set `check: false` and assert the exact exit behavior.
- Do not duplicate source-level unit tests.
