# Use setup-zolt

`setup-zolt` installs a verified Zolt release. Exact pins are recommended, and
following a moving channel requires an explicit `version: latest` input.

## One runner

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
    with:
      persist-credentials: false

  - uses: zoltsh/setup-zolt@28512f86f5c1ce10d6f90849930b0eb3b81fc98b # v1.0.3
    with:
      channel: zap
      version: 0.1.0-zap.20260823.0ea7fe1473b4
      sha256: 11c55e4117d55d1776c5eddca801b8e5f65cc9b16f2c5a8313b9f473547fdd57

  - run: zolt toolchain sync
  - run: zolt test
```

Pin the action to a full commit SHA so reviewed action code cannot move. Pin
Zolt with an exact version and SHA-256 checksum so every run gets the same
archive. This example uses `ubuntu-24.04` (`linux-x64`).

## Follow the current channel

Use `latest` when a workflow should pick up each new channel release
automatically:

```yaml
- uses: zoltsh/setup-zolt@28512f86f5c1ce10d6f90849930b0eb3b81fc98b # v1.0.3
  with:
    channel: zap
    version: latest
```

The action reads the signed channel file and uses its version and checksum. All
download, archive, cache, and version checks still run.

Two runs can install different versions after the channel moves. Use an exact
version and checksum when a build must be repeatable.

## More than one runner

A SHA-256 checksum is a file fingerprint. Because each target has a different
archive, put the matching checksum in each matrix entry.

```yaml
jobs:
  test:
    strategy:
      matrix:
        include:
          - runner: ubuntu-24.04
            sha256: 11c55e4117d55d1776c5eddca801b8e5f65cc9b16f2c5a8313b9f473547fdd57
          - runner: ubuntu-24.04-arm
            sha256: bf8a49aab74d2cc05f01f044b15d7b6b8f8263dc8aefe9168fbd827c3a6253c4
          - runner: macos-15-intel
            sha256: 1e5dc1502ebd3c4dc5672db1fd5e557cae7c894ae28dd5dc30b1569ccd47b41f
          - runner: macos-15
            sha256: 7bca990eea0f22a4f4b354c22ac3109d89818ed969781d43e0cc6442b428d661

    runs-on: ${{ matrix.runner }}

    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - uses: zoltsh/setup-zolt@28512f86f5c1ce10d6f90849930b0eb3b81fc98b # v1.0.3
        with:
          channel: zap
          version: 0.1.0-zap.20260823.0ea7fe1473b4
          sha256: ${{ matrix.sha256 }}

      - run: zolt toolchain sync
      - run: zolt test
```

These values belong only to version `0.1.0-zap.20260823.0ea7fe1473b4`. For a
new version, copy the target's `.sha256` value from its immutable
[`zoltsh/releases`](https://github.com/zoltsh/releases/releases) release. The
action also checks it against the signed metadata stored with that release.

## Outputs

| Output | Meaning |
| :--- | :--- |
| `version` | Installed version |
| `target` | Resolved Zolt target |
| `path` | Absolute path to `zolt` |
| `sha256` | Verified archive checksum |

The action also adds the executable's directory to `PATH` for later steps.

## Action or installer?

Use [`dist.zolt.sh/install.sh`](https://dist.zolt.sh/install.sh) when a person
wants the current channel release. Use this action in CI, with an exact pin for
repeatable builds or `latest` for automatic updates.

Both verify Zolt. The installer always follows the channel's current release;
the action makes that choice explicit.
