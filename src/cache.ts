import { constants } from 'node:fs';
import { lstat, open, realpath, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import * as toolCache from '@actions/tool-cache';

import { SetupZoltError } from './errors';
import { MAX_CACHE_MARKER_BYTES } from './constants';
import { exactKeys, object, parseJson, string } from './json';
import type { ReleaseTarget } from './types';

const MARKER = '.setup-zolt.json';

export interface ToolCache {
    cacheDirectory(source: string, version: string, target: ReleaseTarget): Promise<string>;
    find(version: string, target: ReleaseTarget): string;
}

export class ActionsToolCache implements ToolCache {
    public async cacheDirectory(source: string, version: string, target: ReleaseTarget): Promise<string> {
        return toolCache.cacheDir(source, 'zolt', version, target);
    }

    public find(version: string, target: ReleaseTarget): string {
        return toolCache.find('zolt', version, target);
    }
}

export async function writeCacheMarker(
    root: string,
    version: string,
    target: ReleaseTarget,
    sha256: string,
): Promise<void> {
    const payload = `${JSON.stringify({ schemaVersion: 1, sha256, target, version }, null, 2)}\n`;
    await writeFile(resolve(root, MARKER), payload, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

export async function verifyCacheMarker(
    root: string,
    version: string,
    target: ReleaseTarget,
    sha256: string,
): Promise<void> {
    const markerPath = resolve(root, MARKER);
    let payload: Buffer;
    try {
        const marker = await open(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const status = await marker.stat();
            if (!status.isFile() || status.size === 0 || status.size > MAX_CACHE_MARKER_BYTES) {
                throw new SetupZoltError(
                    `Cached Zolt ${version} for ${target} has an invalid verification marker; refuse to trust this cache entry.`,
                );
            }
            payload = await marker.readFile();
            if (payload.length > MAX_CACHE_MARKER_BYTES) {
                throw new SetupZoltError(
                    `Cached Zolt ${version} for ${target} has an oversized verification marker; refuse to trust this cache entry.`,
                );
            }
        } finally {
            await marker.close();
        }
    } catch (error) {
        if (error instanceof SetupZoltError) throw error;
        if (hasErrorCode(error, 'ELOOP')) {
            throw new SetupZoltError(
                `Cached Zolt ${version} for ${target} has an invalid verification marker; refuse to trust this cache entry.`,
                { cause: error },
            );
        }
        throw new SetupZoltError(
            `Cached Zolt ${version} for ${target} is missing its verification marker; refuse to trust this cache entry.`,
            { cause: error },
        );
    }
    const marker = object(parseJson(payload, 'Zolt tool-cache marker'), 'Zolt tool-cache marker');
    exactKeys(marker, ['schemaVersion', 'sha256', 'target', 'version'], [], 'Zolt tool-cache marker');
    if (marker.schemaVersion !== 1) throw new SetupZoltError('Zolt tool-cache marker has an unsupported schemaVersion.');
    if (
        string(marker, 'version', 'Zolt tool-cache marker') !== version
    || string(marker, 'target', 'Zolt tool-cache marker') !== target
    || string(marker, 'sha256', 'Zolt tool-cache marker') !== sha256
    ) {
        throw new SetupZoltError(
            `Cached Zolt ${version} for ${target} does not match the requested verified release; refuse to reuse it.`,
        );
    }
}

function hasErrorCode(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export async function resolveCachedBinary(root: string, version: string, target: ReleaseTarget): Promise<string> {
    const binary = resolve(root, 'bin', 'zolt');
    try {
        const status = await lstat(binary);
        if (!status.isFile() || status.isSymbolicLink()) {
            throw new SetupZoltError(
                `Cached Zolt ${version} for ${target} does not contain a regular bin/zolt executable.`,
            );
        }
        const cacheRoot = await realpath(root);
        const realBinary = await realpath(binary);
        if (!realBinary.startsWith(`${cacheRoot}${sep}`)) {
            throw new SetupZoltError(`Cached Zolt ${version} for ${target} has a bin/zolt path outside its cache root.`);
        }
        return binary;
    } catch (error) {
        if (error instanceof SetupZoltError) throw error;
        throw new SetupZoltError(
            `Cached Zolt ${version} for ${target} is missing its verified bin/zolt executable.`,
            { cause: error },
        );
    }
}
