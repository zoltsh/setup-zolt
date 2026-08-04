import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import * as actionToolCache from '@actions/tool-cache';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionsToolCache, resolveCachedBinary, verifyCacheMarker, writeCacheMarker } from '../src/cache';
import { FIXTURE_SHA256, FIXTURE_TARGET, FIXTURE_VERSION } from './helpers';

const roots: string[] = [];

vi.mock('@actions/tool-cache', () => ({
    cacheDir: vi.fn(),
    find: vi.fn(),
}));

afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })));
});

describe('tool-cache verification marker', () => {
    it('uses the standard Zolt cache namespace', async () => {
        vi.mocked(actionToolCache.cacheDir).mockResolvedValue('/cache/zolt');
        vi.mocked(actionToolCache.find).mockReturnValue('/cache/zolt');
        const cache = new ActionsToolCache();
        await expect(cache.cacheDirectory('/source', FIXTURE_VERSION, FIXTURE_TARGET)).resolves.toBe('/cache/zolt');
        expect(actionToolCache.cacheDir).toHaveBeenCalledWith('/source', 'zolt', FIXTURE_VERSION, FIXTURE_TARGET);
        expect(cache.find(FIXTURE_VERSION, FIXTURE_TARGET)).toBe('/cache/zolt');
        expect(actionToolCache.find).toHaveBeenCalledWith('zolt', FIXTURE_VERSION, FIXTURE_TARGET);
    });

    it('round-trips the exact version, target, and checksum', async () => {
        const root = await temporaryRoot();
        await writeCacheMarker(root, FIXTURE_VERSION, FIXTURE_TARGET, FIXTURE_SHA256);
        await expect(verifyCacheMarker(root, FIXTURE_VERSION, FIXTURE_TARGET, FIXTURE_SHA256))
            .resolves.toBeUndefined();
    });

    it('rejects missing, malformed, stale, and unknown marker data', async () => {
        const missing = await temporaryRoot();
        await expect(verifyCacheMarker(missing, FIXTURE_VERSION, FIXTURE_TARGET, FIXTURE_SHA256))
            .rejects.toThrow(/missing its verification marker/u);

        const malformed = await temporaryRoot();
        await writeFile(resolve(malformed, '.setup-zolt.json'), '{');
        await expect(verifyCacheMarker(malformed, FIXTURE_VERSION, FIXTURE_TARGET, FIXTURE_SHA256))
            .rejects.toThrow(/not valid JSON/u);

        const stale = await temporaryRoot();
        await writeCacheMarker(stale, FIXTURE_VERSION, FIXTURE_TARGET, FIXTURE_SHA256);
        await expect(verifyCacheMarker(stale, '0.0.1', FIXTURE_TARGET, FIXTURE_SHA256))
            .rejects.toThrow(/does not match/u);

        const unknown = await temporaryRoot();
        await writeFile(resolve(unknown, '.setup-zolt.json'), JSON.stringify({
            extra: true,
            schemaVersion: 1,
            sha256: FIXTURE_SHA256,
            target: FIXTURE_TARGET,
            version: FIXTURE_VERSION,
        }));
        await expect(verifyCacheMarker(unknown, FIXTURE_VERSION, FIXTURE_TARGET, FIXTURE_SHA256))
            .rejects.toThrow(/unsupported field/u);

        const schema = await temporaryRoot();
        await writeFile(resolve(schema, '.setup-zolt.json'), JSON.stringify({
            schemaVersion: 2,
            sha256: FIXTURE_SHA256,
            target: FIXTURE_TARGET,
            version: FIXTURE_VERSION,
        }));
        await expect(verifyCacheMarker(schema, FIXTURE_VERSION, FIXTURE_TARGET, FIXTURE_SHA256))
            .rejects.toThrow(/unsupported schemaVersion/u);

        const oversized = await temporaryRoot();
        await writeFile(resolve(oversized, '.setup-zolt.json'), 'x'.repeat(4097));
        await expect(verifyCacheMarker(oversized, FIXTURE_VERSION, FIXTURE_TARGET, FIXTURE_SHA256))
            .rejects.toThrow(/invalid verification marker/u);

        const linked = await temporaryRoot();
        const markerTarget = resolve(linked, 'marker-target');
        await writeFile(markerTarget, '{}');
        await symlink(markerTarget, resolve(linked, '.setup-zolt.json'));
        await expect(verifyCacheMarker(linked, FIXTURE_VERSION, FIXTURE_TARGET, FIXTURE_SHA256))
            .rejects.toThrow(/invalid verification marker/u);
    });

    it('requires the cached binary to be regular and contained', async () => {
        const valid = await temporaryRoot();
        await mkdir(resolve(valid, 'bin'));
        await writeFile(resolve(valid, 'bin', 'zolt'), 'binary');
        await expect(resolveCachedBinary(valid, FIXTURE_VERSION, FIXTURE_TARGET))
            .resolves.toBe(resolve(valid, 'bin', 'zolt'));

        const missing = await temporaryRoot();
        await expect(resolveCachedBinary(missing, FIXTURE_VERSION, FIXTURE_TARGET))
            .rejects.toThrow(/missing its verified/u);

        const escaped = await temporaryRoot();
        const outside = await temporaryRoot();
        await writeFile(resolve(outside, 'zolt'), 'binary');
        await symlink(outside, resolve(escaped, 'bin'));
        await expect(resolveCachedBinary(escaped, FIXTURE_VERSION, FIXTURE_TARGET))
            .rejects.toThrow(/outside its cache root/u);
    });
});

async function temporaryRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'setup-zolt-cache-test-'));
    roots.push(root);
    return root;
}
