# Contributing

Keep each change small enough to review as one security-sensitive decision.

Install Node.js 22.18 or newer and `actionlint` before running the checks.

Before opening a pull request:

```console
npm ci
npm run bundle
scripts/check
npm audit
git diff --check
```

Requirements:

- preserve exact-version and exact-checksum behavior;
- keep moving selection limited to explicit `version: latest` and signed
  channel metadata;
- keep the distribution origin and paths explicit;
- add a failure-path test for every new parser, downloader, archive, or cache
  behavior;
- keep dependency installation lifecycle scripts disabled unless a reviewed,
  documented build requirement makes one unavoidable;
- commit the deterministic `dist/` output when runtime code changes;
- keep the `smoque` test focused on the real committed artifact boundary;
- pin every third-party workflow action to a full commit SHA;
- use conventional, OpenPGP-signed commits with no coauthor trailers.

An arbitrary URL, implicit moving version, new platform, new archive type, or
new signing key changes the security model. Document it and add integration
coverage.
