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

  - uses: zoltsh/setup-zolt@daaac64a8f2b58dd8ee0ab53b16085a64e20a0ad # v1.0.2
    with:
      channel: zap
      version: 0.1.0-zap.20260804.6ccff768b7bc
      sha256: e05b00e206d312ddf15954370ed904c114f7037f9da6a0a69cc7ddd4ee7e3f55

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
- uses: zoltsh/setup-zolt@daaac64a8f2b58dd8ee0ab53b16085a64e20a0ad # v1.0.2
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
            sha256: e05b00e206d312ddf15954370ed904c114f7037f9da6a0a69cc7ddd4ee7e3f55
          - runner: ubuntu-24.04-arm
            sha256: 7bb6a9c1953dbc4a2a242665da8a1219a6fb0f90e6f31c62c282e0523afd91a0
          - runner: macos-15-intel
            sha256: ed576be109b0280ce1a4d6951d63db037c05491e2d1feab231f0118b7d843721
          - runner: macos-15
            sha256: a7f899bdeab3f8027d52b4fabc8ebf69859a7c8f1d84d90d84817e977e22dc91

    runs-on: ${{ matrix.runner }}

    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - uses: zoltsh/setup-zolt@daaac64a8f2b58dd8ee0ab53b16085a64e20a0ad # v1.0.2
        with:
          channel: zap
          version: 0.1.0-zap.20260804.6ccff768b7bc
          sha256: ${{ matrix.sha256 }}

      - run: zolt toolchain sync
      - run: zolt test
```

These values belong only to version `0.1.0-zap.20260804.6ccff768b7bc`. For a
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
