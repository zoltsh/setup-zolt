import { createHash } from 'node:crypto';
import { copyFile, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { create } from 'tar';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolCache } from '../src/cache';
import { installZolt } from '../src/install';
import type { ActionInputs, DownloadResult, ReleaseSelection, Transport } from '../src/types';
import { FIXTURE_TARGET, FIXTURE_VERSION, githubArchiveUrl } from './helpers';

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })));
});

describe('Zolt installation', () => {
    it('downloads, verifies, caches, and then safely reuses one exact archive', async () => {
        const fixture = await installFixture();
        const verify = vi.fn(async () => Promise.resolve());
        const dependencies = {
            cache: fixture.cache,
            resolve: async () => Promise.resolve(fixture.release),
            temporaryRoot: fixture.work,
            verifyVersion: verify,
        };
        const first = await installZolt(fixture.inputs, FIXTURE_TARGET, fixture.transport, dependencies);
        expect(first.cacheHit).toBe(false);
        await expect(readFile(first.binary, 'utf8')).resolves.toContain(FIXTURE_VERSION);
        expect(verify).toHaveBeenCalledTimes(2);

        const second = await installZolt(fixture.inputs, FIXTURE_TARGET, fixture.transport, dependencies);
        expect(second.cacheHit).toBe(true);
        expect(second.binary).toBe(first.binary);
        expect(verify).toHaveBeenCalledTimes(3);
    });

    it('rejects caller and downloaded checksum mismatches before caching', async () => {
        const fixture = await installFixture();
        const callerMismatch = { ...fixture.inputs, sha256: '0'.repeat(64) };
        await expect(installZolt(callerMismatch, FIXTURE_TARGET, fixture.transport, {
            cache: fixture.cache,
            resolve: async () => Promise.resolve(fixture.release),
            temporaryRoot: fixture.work,
            verifyVersion: async () => Promise.resolve(),
        })).rejects.toThrow(/does not match signed release metadata/u);

        const corruptTransport: Transport = {
            download: async () => Promise.resolve({ bytes: 1, sha256: 'f'.repeat(64) }),
            read: async () => Promise.resolve(Buffer.alloc(0)),
        };
        await expect(installZolt(fixture.inputs, FIXTURE_TARGET, corruptTransport, {
            cache: fixture.cache,
            resolve: async () => Promise.resolve(fixture.release),
            temporaryRoot: fixture.work,
            verifyVersion: async () => Promise.resolve(),
        })).rejects.toThrow(/checksum mismatch/u);
    });

    it('uses the signed version and checksum for an explicit latest selection', async () => {
        const fixture = await installFixture();
        const resolveLatest = vi.fn(async () => Promise.resolve(fixture.release));
        const result = await installZolt(
            { channel: 'zap', sha256: undefined, version: 'latest' },
            FIXTURE_TARGET,
            fixture.transport,
            {
                cache: fixture.cache,
                resolve: resolveLatest,
                temporaryRoot: fixture.work,
                verifyVersion: async () => Promise.resolve(),
            },
        );
        expect(resolveLatest).toHaveBeenCalledWith(fixture.transport, 'zap', 'latest', FIXTURE_TARGET);
        expect(result).toMatchObject({
            cacheHit: false,
            sha256: fixture.release.artifact.sha256,
            version: FIXTURE_VERSION,
        });
    });

    it('still enforces a caller checksum when latest provides one', async () => {
        const fixture = await installFixture();
        await expect(installZolt(
            { channel: 'zap', sha256: '0'.repeat(64), version: 'latest' },
            FIXTURE_TARGET,
            fixture.transport,
            {
                cache: fixture.cache,
                resolve: async () => Promise.resolve(fixture.release),
                temporaryRoot: fixture.work,
                verifyVersion: async () => Promise.resolve(),
            },
        )).rejects.toThrow(/does not match signed release metadata/u);
    });

    it('does not allow an exact installation without a caller checksum', async () => {
        const fixture = await installFixture();
        const resolveExact = vi.fn(async () => Promise.resolve(fixture.release));
        await expect(installZolt(
            { ...fixture.inputs, sha256: undefined },
            FIXTURE_TARGET,
            fixture.transport,
            {
                cache: fixture.cache,
                resolve: resolveExact,
                temporaryRoot: fixture.work,
                verifyVersion: async () => Promise.resolve(),
            },
        )).rejects.toThrow(/sha256.*required.*exact/u);
        expect(resolveExact).not.toHaveBeenCalled();
    });

    it('preserves the installation failure when temporary cleanup also fails', async () => {
        const fixture = await installFixture();
        const corruptTransport: Transport = {
            download: async () => Promise.resolve({ bytes: 1, sha256: 'f'.repeat(64) }),
            read: async () => Promise.resolve(Buffer.alloc(0)),
        };
        await expect(installZolt(fixture.inputs, FIXTURE_TARGET, corruptTransport, {
            cache: fixture.cache,
            remove: async () => Promise.reject(new Error('filesystem is read-only')),
            resolve: async () => Promise.resolve(fixture.release),
            temporaryRoot: fixture.work,
            verifyVersion: async () => Promise.resolve(),
        })).rejects.toThrow(/checksum mismatch.*cleanup also failed/u);
    });

    it('fails if a successful installation leaves its temporary directory behind', async () => {
        const fixture = await installFixture();
        await expect(installZolt(fixture.inputs, FIXTURE_TARGET, fixture.transport, {
            cache: fixture.cache,
            remove: async () => Promise.reject(new Error('filesystem is read-only')),
            resolve: async () => Promise.resolve(fixture.release),
            temporaryRoot: fixture.work,
            verifyVersion: async () => Promise.resolve(),
        })).rejects.toThrow(/Could not remove the temporary Zolt installation directory/u);
    });
});

class FixtureCache implements ToolCache {
    #cached = '';

    constructor(private readonly root: string) {}

    public async cacheDirectory(source: string): Promise<string> {
        const destination = resolve(this.root, 'cached-zolt');
        await cp(source, destination, { recursive: true });
        this.#cached = destination;
        return destination;
    }

    public find(): string {
        return this.#cached;
    }
}

async function installFixture(): Promise<{
    cache: FixtureCache;
    inputs: ActionInputs;
    release: ReleaseSelection;
    transport: Transport;
    work: string;
}> {
    const root = await mkdtemp(join(tmpdir(), 'setup-zolt-install-test-'));
    roots.push(root);
    const expectedRoot = `zolt-${FIXTURE_VERSION}-${FIXTURE_TARGET}`;
    const packageRoot = resolve(root, 'package', expectedRoot);
    await mkdir(resolve(packageRoot, 'bin'), { recursive: true });
    await writeFile(
        resolve(packageRoot, 'bin', 'zolt'),
        `#!/bin/sh\nprintf "${FIXTURE_VERSION}\\n"\n`,
        { mode: 0o755 },
    );
    const sourceArchive = resolve(root, `${expectedRoot}.tar.gz`);
    await create({ cwd: resolve(root, 'package'), file: sourceArchive, gzip: true, portable: true }, [expectedRoot]);
    const archiveBytes = await readFile(sourceArchive);
    const sha256 = createHash('sha256').update(archiveBytes).digest('hex');
    const release: ReleaseSelection = {
        artifact: {
            archive: `${expectedRoot}.tar.gz`,
            archiveUrl: githubArchiveUrl(FIXTURE_VERSION, `${expectedRoot}.tar.gz`),
            binaryName: 'zolt',
            format: 'tar.gz',
            sha256,
            target: FIXTURE_TARGET,
        },
        channel: 'zap',
        commit: 'ec2351c8774658f8790b47ea8081b7b8d1343938',
        createdAt: '2026-07-28T11:04:26Z',
        version: FIXTURE_VERSION,
    };
    const transport: Transport = {
        download: async (_url, destination): Promise<DownloadResult> => {
            await copyFile(sourceArchive, destination);
            return { bytes: archiveBytes.length, sha256 };
        },
        read: async () => Promise.resolve(Buffer.alloc(0)),
    };
    const work = resolve(root, 'work');
    return {
        cache: new FixtureCache(resolve(root, 'cache')),
        inputs: { channel: 'zap', sha256, version: FIXTURE_VERSION },
        release,
        transport,
        work,
    };
}
