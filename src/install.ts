import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { extractTarGz, inspectTarGz } from './archive';
import {
    ActionsToolCache,
    type ToolCache,
    resolveCachedBinary,
    verifyCacheMarker,
    writeCacheMarker,
} from './cache';
import { LATEST_VERSION_SELECTOR, MAX_ARCHIVE_BYTES } from './constants';
import { SetupZoltError, errorMessage } from './errors';
import { resolveRelease } from './releases';
import type { ActionInputs, Channel, ReleaseSelection, ReleaseTarget, Transport } from './types';
import { verifyZoltVersion } from './verify';

export interface InstallResult {
    readonly binary: string;
    readonly cacheHit: boolean;
    readonly sha256: string;
    readonly target: ReleaseTarget;
    readonly version: string;
}

export interface InstallDependencies {
    readonly cache?: ToolCache;
    readonly remove?: (path: string) => Promise<void>;
    readonly resolve?: (
        transport: Transport,
        channel: Channel,
        version: string,
        target: ReleaseTarget,
    ) => Promise<ReleaseSelection>;
    readonly temporaryRoot?: string;
    readonly verifyVersion?: (binary: string, expectedVersion: string) => Promise<void>;
}

export async function installZolt(
    inputs: ActionInputs,
    target: ReleaseTarget,
    transport: Transport,
    dependencies: InstallDependencies = {},
): Promise<InstallResult> {
    const cache = dependencies.cache ?? new ActionsToolCache();
    const remove = dependencies.remove ?? (async (path: string) => rm(path, { force: true, recursive: true }));
    const verifyVersion = dependencies.verifyVersion ?? verifyZoltVersion;
    const resolveSelectedRelease = dependencies.resolve ?? resolveRelease;
    if (inputs.sha256 === undefined && inputs.version !== LATEST_VERSION_SELECTOR) {
        throw new SetupZoltError('Input `sha256` is required when `version` is an exact Zolt version.');
    }
    const release = await resolveSelectedRelease(transport, inputs.channel, inputs.version, target);
    if (inputs.sha256 !== undefined && release.artifact.sha256 !== inputs.sha256) {
        throw new SetupZoltError(
            `Input \`sha256\` does not match signed release metadata for ${release.version}/${target}. Expected ${release.artifact.sha256}.`,
        );
    }
    const sha256 = inputs.sha256 ?? release.artifact.sha256;
    const version = release.version;

    const cached = cache.find(version, target);
    if (cached !== '') {
        await verifyCacheMarker(cached, version, target, sha256);
        const binary = await resolveCachedBinary(cached, version, target);
        await verifyVersion(binary, version);
        return { binary, cacheHit: true, sha256, target, version };
    }

    const temporaryBase = dependencies.temporaryRoot ?? process.env.RUNNER_TEMP ?? tmpdir();
    await mkdir(temporaryBase, { recursive: true });
    const work = await mkdtemp(join(temporaryBase, 'setup-zolt-'));
    let result: InstallResult;
    try {
        const archive = resolve(work, release.artifact.archive);
        const download = await transport.download(
            new URL(release.artifact.archiveUrl),
            archive,
            MAX_ARCHIVE_BYTES,
            'native Zolt archive',
        );
        if (download.sha256 !== sha256) {
            throw new SetupZoltError(
                `Downloaded Zolt archive checksum mismatch. Expected ${sha256}, received ${download.sha256}.`,
            );
        }
        const expectedRoot = release.artifact.archive.slice(0, -'.tar.gz'.length);
        await inspectTarGz(archive, expectedRoot);
        const extracted = await extractTarGz(archive, resolve(work, 'extract'), expectedRoot);
        const extractedBinary = resolve(extracted, 'bin', 'zolt');
        await verifyVersion(extractedBinary, version);
        await writeCacheMarker(extracted, version, target, sha256);
        const cachedRoot = await cache.cacheDirectory(extracted, version, target);
        await verifyCacheMarker(cachedRoot, version, target, sha256);
        const binary = await resolveCachedBinary(cachedRoot, version, target);
        await verifyVersion(binary, version);
        result = { binary, cacheHit: false, sha256, target, version };
    } catch (error) {
        await removeTemporaryDirectory(work, remove, error);
        throw error;
    }
    await removeTemporaryDirectory(work, remove);
    return result;
}

async function removeTemporaryDirectory(
    path: string,
    remove: (path: string) => Promise<void>,
    operationError?: unknown,
): Promise<void> {
    try {
        await remove(path);
    } catch (cleanupError) {
        const message = operationError === undefined
            ? 'Could not remove the temporary Zolt installation directory.'
            : `${errorMessage(operationError)} Temporary-directory cleanup also failed.`;
        throw new SetupZoltError(message, { cause: cleanupError });
    }
}
