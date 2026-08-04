# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/zoltsh/setup-zolt/security/advisories/new).
Do not open a public issue for a suspected vulnerability.

Include the affected action ref, runner target, relevant workflow inputs, and a
minimal reproduction. Do not include credentials or private repository data.

## Supported versions

Security fixes are applied to the current major action line. Zolt-owned
workflows pin the action to a full commit SHA and update that pin after a fix is
reviewed and released.

## Security boundary

`setup-zolt` treats release metadata, HTTP responses, archives, runner caches,
and action inputs as untrusted. It stops instead of guessing or falling back
when a signature, checksum, path, archive entry, cache marker, or version does
not match.

The action does not protect a workflow from a compromised self-hosted runner,
a compromised action commit already selected by the workflow, or an attacker
who controls both the workflow and its expected checksum.

The detailed threat model is in [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).
