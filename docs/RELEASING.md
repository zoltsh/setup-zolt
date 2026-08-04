# Releasing

Action releases contain committed JavaScript; they do not publish an npm
package.

## Prepare

1. Confirm `main` is clean and protected.
2. Run `npm ci` and review the complete `npm audit`, including build and test
   tooling that executes in trusted release workflows.
3. Run `npm run bundle`.
4. Run `scripts/check` and `git diff --check`.
5. Confirm the four-target integration workflow passed for the exact commit.
6. Review `dist/licenses.txt` and the source-to-bundle diff.

## Publish

1. Create an OpenPGP-signed annotated tag such as `v1.0.0` on the verified
   commit.
2. Push the immutable release tag.
3. Create a GitHub release from that tag and enable immutable releases when the
   repository setting is available.
4. Move the compatibility tag `v1` only after the immutable release is public
   and verified.
5. Update Zolt-owned workflows to the release commit's full SHA, not `v1`.

Do not rebuild `dist/` while tagging. The reviewed commit is the release
artifact.

## Verify

- Confirm the release tag resolves to the reviewed signed commit.
- Run a consumer workflow pinned to the full commit SHA.
- Confirm the action reports the expected version, target, path, and checksum.
- Confirm an intentionally wrong checksum fails.
