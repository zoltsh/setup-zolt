# Architecture

`setup-zolt` has one job: turn a version choice and runner target into one
verified executable on `PATH`.

```text
workflow inputs
    |
    v
strict input and runner-target validation
    |
    v
latest: dist.zolt.sh/channels/<channel>.json + .sig
exact:  immutable GitHub Release/channel-<channel>.json + .sig
    |
    v
Ed25519 verification of raw bytes
    |
    v
strict schema, host, path, version, and target resolution
    |
    v
pinned checksum, when present, == signed checksum == downloaded checksum
    |
    v
archive inspection -> extraction -> version smoke
    |
    v
verified runner tool-cache entry -> PATH and outputs
```

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `inputs.ts` | Public action input validation |
| `platform.ts` | Runner OS and architecture mapping |
| `signatures.ts` | Separate signature-file parsing and Ed25519 verification |
| `release-schema.ts` | Strict channel-manifest parsing |
| `releases.ts` | Signed metadata download and version selection |
| `http.ts` | Proxy-aware, bounded streaming transport |
| `archive.ts` | Tar entry policy, inspection, and extraction |
| `cache.ts` | Tool-cache adapter and verification marker |
| `verify.ts` | Exact `zolt --version` smoke |
| `install.ts` | Installation transaction orchestration |
| `main.ts` | Testable GitHub Actions adapter, PATH, outputs, and failure mapping |
| `index.ts` | Minimal bundled-action entrypoint |

Parsing, cryptography, network I/O, archive handling, and caching remain
separate so each failure boundary can be tested without a live workflow.

## Rules that must stay true

1. The action resolves a moving version only for explicit `version: latest`.
2. The selected channel manifest is authenticated before its JSON is
   interpreted. Exact versions use the frozen copy attached to their immutable
   GitHub Release.
3. An exact version requires a workflow checksum. When present, that checksum
   must match authenticated metadata.
4. The downloaded bytes must match that same checksum.
5. Metadata cannot redirect. Archive metadata must name one exact, fixed
   Zolt asset layout; GitHub asset delivery may redirect only over HTTPS, while
   the authenticated checksum pins the final bytes.
6. Inspection and extraction never accept traversal, absolute paths, links,
   special files, duplicate paths, case-colliding paths, or setuid/setgid
   entries. Compressed and expanded sizes and their ratio are bounded.
7. The archive has one expected top-level directory and one regular
   `bin/zolt` executable.
8. A tool-cache hit must retain the exact version, target, and checksum marker,
   plus a regular binary whose real path remains inside the cache root.
9. Every installed or cached binary must print only the resolved version on
   stdout.
10. Java, project dependency caches, publication, and release credentials stay
    outside this action.

## Failure behavior

There is no retry that changes the resolved version, channel, target, origin,
or checksum. HTTP retries may repeat only the same download request. A mismatch
ends the action and reports which rule failed.

Temporary downloads and extraction directories are removed on both success and
failure. If installation and cleanup both fail, the action reports both rather
than hiding the installation failure. A verified cache entry is written only
after inspection, extraction, checksum verification, and the first version
check succeed.
