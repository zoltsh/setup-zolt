# Security model

In plain language: the workflow chooses an exact release or explicitly asks for
the channel's current release. Signed metadata confirms that choice, and the
downloaded bytes must have its checksum. The action stops if any check
disagrees.

## Assets

The action protects the identity and integrity of the Zolt executable selected
by a workflow. It also protects the runner workspace from archive traversal and
special-file extraction.

## What the action trusts

- The action ref selected by the calling workflow.
- The Ed25519 public keys committed in `src/constants.ts`.
- For pinned installs, the exact SHA-256 checksum in the calling workflow.
- GitHub's runner isolation and tool-cache ownership.

HTTPS protects transport privacy and availability, but it is not the only file
check. Signed distribution metadata is always authoritative. A workflow
checksum is an additional requirement for an exact version.

## Untrusted inputs

- action inputs;
- operating-system and architecture strings;
- HTTP status, headers, and bodies;
- channel-manifest or release-index JSON before signature verification;
- every metadata field after parsing;
- compressed and extracted archive entries;
- pre-existing tool-cache contents;
- output from the downloaded executable.

## Controls

### Metadata

Metadata and signature downloads have hard byte limits and cannot redirect.
The action requests identity encoding and verifies the signature over the exact
response bytes before strict UTF-8 decoding or JSON parsing. The parser rejects
missing, unknown, duplicate, malformed, or excessive records and implements the
publisher's current schema rather than speculative future fields.

Metadata URLs are constructed from the fixed `https://dist.zolt.sh` origin. An
archive URL must exactly match the channel's immutable `zoltsh/releases` GitHub
release asset path. Signed metadata cannot substitute credentials, queries,
fragments, another repository, another channel tag, or another filename.

### Moving selection

`version: latest` selects the release named by the signed channel manifest. It
does not weaken signature, URL, checksum, archive, cache, or version checks, but
it does give the channel permission to change the selected version.

A signature proves who published metadata; it does not make two workflow runs
choose the same channel state. Previously signed metadata could also be replayed
if the fixed HTTPS distribution endpoint were compromised. Workflows that need
repeatability or protection from a moving channel should pin an exact version
and checksum.

### Archive

Archive downloads stream to a newly created file and are hashed during the
write. They have compressed-size, gzip decompression-ratio, entry-count,
per-entry-size, path-byte-length, and total expanded-size limits.

GitHub release asset requests may follow at most five HTTPS redirects because
GitHub serves release bytes from a separate asset host. HTTPS-to-HTTP downgrade
is disabled. The signed checksum always authenticates the final response bytes;
a workflow checksum must also match when provided. A redirect cannot change the
accepted archive.

The inspection pass rejects:

- absolute, parent, empty, repeated-separator, backslash, drive-letter, NUL, or
  overlong paths;
- symbolic links, hard links, devices, FIFOs, and unsupported entry types;
- duplicate and case-colliding paths;
- setuid and setgid modes;
- entries outside the expected top-level directory;
- archives without the expected regular `bin/zolt` file.

Extraction repeats the complete entry policy, including entry type, size,
privilege bits, and path validation. Real paths are checked after extraction,
and the executable is required to remain beneath the owned extraction root.

### Cache

The cache key includes the exact version and target. A bounded, regular,
non-symlink marker inside the cache records the schema, version, target, and
checksum. Missing, malformed, oversized, or stale markers stop the action. The
cached binary must also be a regular non-symlink whose real path remains inside
the cache root. The signed metadata check and binary version check still run on
cache hits.

A user with write access to a self-hosted runner can tamper with both cache data
and local execution. That runner is outside this action's security boundary.

## Key rotation

1. Add the new public key with a unique key ID.
2. Add signature fixtures and a live integration proof for the new key.
3. Publish an action release containing both old and new keys.
4. Begin signing distribution metadata with the new key.
5. Wait until supported workflows have updated their action pin.
6. Remove the old key in a later major or security release.

Never replace key material under an existing key ID.
