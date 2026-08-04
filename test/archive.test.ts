import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import { create } from 'tar';
import { afterEach, describe, expect, it } from 'vitest';

import { extractTarGz, inspectTarGz, validateArchiveEntry, validateArchivePath } from '../src/archive';

const compress = promisify(gzip);
const roots: string[] = [];

afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })));
});

describe('archive path policy', () => {
    it.each([
        '',
        '/zolt/bin/zolt',
        '../zolt/bin/zolt',
        'zolt/../bin/zolt',
        'zolt//bin/zolt',
        'zolt\\bin\\zolt',
        'C:/zolt/bin/zolt',
        'other/bin/zolt',
        `zolt/${'é'.repeat(256)}`,
    ])('rejects unsafe entry %s', (entry) => {
        expect(() => validateArchivePath(entry, 'zolt')).toThrow();
    });

    it('canonicalizes a harmless leading dot and directory slash', () => {
        expect(validateArchivePath('./zolt/bin/', 'zolt')).toBe('zolt/bin');
    });

    it.each(['SymbolicLink', 'Link', 'CharacterDevice', 'FIFO'])('rejects entry type %s', (type) => {
        expect(() => validateArchiveEntry({ path: 'zolt/bin/zolt', size: 1, type }, 'zolt'))
            .toThrow(/forbidden type/u);
    });

    it('rejects excessive sizes and privilege bits', () => {
        expect(() => validateArchiveEntry({ path: 'zolt/bin/zolt', size: Number.NaN, type: 'File' }, 'zolt'))
            .toThrow(/size/u);
        expect(() => validateArchiveEntry({ mode: 0o4755, path: 'zolt/bin/zolt', size: 1, type: 'File' }, 'zolt'))
            .toThrow(/setuid/u);
    });
});

describe('tar.gz inspection and extraction', () => {
    it('accepts one safe root and extracts its real binary', async () => {
        const fixture = await archiveFixture();
        await expect(inspectTarGz(fixture.archive, fixture.expectedRoot)).resolves.toBeUndefined();
        const destination = resolve(fixture.root, 'extract');
        const extracted = await extractTarGz(fixture.archive, destination, fixture.expectedRoot);
        await expect(readFile(resolve(extracted, 'bin', 'zolt'), 'utf8')).resolves.toContain('0.1.0');
    });

    it('rejects archives with links or without the expected binary', async () => {
        const linked = await archiveFixture({ link: true });
        await expect(inspectTarGz(linked.archive, linked.expectedRoot)).rejects.toThrow(/forbidden type/u);
        await expect(extractTarGz(linked.archive, resolve(linked.root, 'linked-extract'), linked.expectedRoot))
            .rejects.toThrow(/forbidden type/u);
        const missing = await archiveFixture({ binary: false });
        await expect(inspectTarGz(missing.archive, missing.expectedRoot)).rejects.toThrow(/missing/u);
    });

    it('rejects duplicate archive entries', async () => {
        const fixture = await archiveFixture({ duplicate: true });
        await expect(inspectTarGz(fixture.archive, fixture.expectedRoot)).rejects.toThrow(/repeats or case-collides/u);
    });

    it('rejects an empty tar stream', async () => {
        const root = await temporaryRoot();
        const archive = resolve(root, 'empty.tar.gz');
        await writeFile(archive, await compress(Buffer.alloc(1024)));
        await expect(inspectTarGz(archive, 'zolt')).rejects.toThrow(/empty|Could not inspect/u);
    });

    it('bounds the compression ratio before extraction', async () => {
        const root = await temporaryRoot();
        const expectedRoot = 'zolt-0.1.0-linux-x64';
        const packageRoot = resolve(root, expectedRoot);
        await mkdir(resolve(packageRoot, 'bin'), { recursive: true });
        await writeFile(resolve(packageRoot, 'bin', 'zolt'), Buffer.alloc(1024 * 1024), { mode: 0o755 });
        const archive = resolve(root, 'compression-bomb.tar.gz');
        await create({ cwd: root, file: archive, gzip: true, portable: true }, [expectedRoot]);
        await expect(inspectTarGz(archive, expectedRoot)).rejects.toThrow(/decompression ratio|Could not inspect/u);
    });
});

async function archiveFixture(options: { binary?: boolean; duplicate?: boolean; link?: boolean } = {}): Promise<{
    archive: string;
    expectedRoot: string;
    root: string;
}> {
    const root = await temporaryRoot();
    const expectedRoot = 'zolt-0.1.0-linux-x64';
    const packageRoot = resolve(root, expectedRoot);
    await mkdir(resolve(packageRoot, 'bin'), { recursive: true });
    if (options.binary !== false) {
        await writeFile(resolve(packageRoot, 'bin', 'zolt'), '#!/bin/sh\nprintf "0.1.0\\n"\n', { mode: 0o755 });
    }
    if (options.link === true) await symlink('zolt', resolve(packageRoot, 'bin', 'zolt-link'));
    const archive = resolve(root, 'zolt.tar.gz');
    await create(
        { cwd: root, file: archive, gzip: true, portable: true },
        options.duplicate === true ? [expectedRoot, expectedRoot] : [expectedRoot],
    );
    return { archive, expectedRoot, root };
}

async function temporaryRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'setup-zolt-test-'));
    roots.push(root);
    return root;
}
