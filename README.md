<p align="center">
  <img src="https://raw.githubusercontent.com/zoltsh/zolt/main/logo.svg" alt="zolt" width="720">
</p>

<h3 align="center">Install Zolt in GitHub Actions</h3>

<p align="center">
  Pin a Zolt release, or explicitly follow a channel.
</p>

<p align="center">
  <a href="#use">Use</a>
  <span> · </span>
  <a href="#inputs">Inputs</a>
  <span> · </span>
  <a href="./docs/USAGE.md">Guide</a>
  <span> · </span>
  <a href="./docs/SECURITY-MODEL.md">Security</a>
  <span> · </span>
  <a href="#development">Development</a>
</p>

<br />

## Use

Recommended: pin the action, the Zolt version, and the archive's SHA-256
checksum.

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

  - run: zolt test
```

SHA-256 is the archive's fingerprint. Each operating system and CPU needs its
own value. The example above uses `ubuntu-24.04` (`linux-x64`). See the
[usage guide](./docs/USAGE.md) for matrices and outputs.

To follow the current channel release instead:

```yaml
- uses: zoltsh/setup-zolt@daaac64a8f2b58dd8ee0ab53b16085a64e20a0ad # v1.0.2
  with:
    channel: zap
    version: latest
```

`latest` still verifies the signed channel file, archive checksum, and archive
contents. It can install a different Zolt version when the channel moves, so
exact pins are better for repeatable CI.

## What it does

The action checks Zolt's signed release metadata, downloads the matching archive
from [`zoltsh/releases`](https://github.com/zoltsh/releases/releases), verifies
its checksum and contents, and adds `zolt` to `PATH`.

It installs Zolt only. Your workflow keeps control of Java, Zolt toolchains,
dependency caches, and release credentials.

## Inputs

| Input | Required | Meaning |
| :--- | :---: | :--- |
| `version` | Yes | Exact Zolt version, or `latest` |
| `sha256` | For exact versions | SHA-256 for this runner's archive |
| `channel` | No | Release channel; defaults to `zap` |

Only `zap` is available today. `preview` and `stable` will be enabled after
their signed distribution metadata and four-target CI checks are live.

## Runners

Supported targets are `linux-x64`, `linux-arm64`, `macos-x64`, and
`macos-arm64`. Windows is not supported yet. Self-hosted runners need Actions
Runner 2.327.1 or newer for the Node 24 action runtime.

## Read more

| Read | When you need it |
| :--- | :--- |
| [Usage guide](./docs/USAGE.md) | Configure one runner or a build matrix |
| [Architecture](./docs/ARCHITECTURE.md) | Understand the modules and rules |
| [Security model](./docs/SECURITY-MODEL.md) | Review what the action trusts and rejects |
| [Release guide](./docs/RELEASING.md) | Publish a new action release |
| [Contributing](./CONTRIBUTING.md) | Change the action safely |

## Development

Local development needs Node 22.18 or newer in the Node 22 line, or Node 24 or
newer. GitHub runs the bundled action with Node 24.

```sh
npm ci
scripts/check
```

`scripts/check` checks types and style, runs unit and `smoque` smoke tests,
rebuilds `dist/` for comparison, and validates the workflows.

## License

Apache-2.0. See [LICENSE](./LICENSE).
