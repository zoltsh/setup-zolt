import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyZoltVersion } from '../src/verify';

const roots: string[] = [];

afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })));
});

describe('installed binary smoke', () => {
    it('requires exact version-only stdout', async () => {
        const binary = await executable('printf "0.3.2\\n"');
        await expect(verifyZoltVersion(binary, '0.3.2')).resolves.toBeUndefined();
        await expect(verifyZoltVersion(binary, '0.3.3')).rejects.toThrow(/failed its version check/u);
        const padded = await executable('printf " 0.3.2\\n"');
        await expect(verifyZoltVersion(padded, '0.3.2')).rejects.toThrow(/failed its version check/u);
        const extra = await executable('printf "0.3.2\\nextra\\n"');
        await expect(verifyZoltVersion(extra, '0.3.2')).rejects.toThrow(/failed its version check/u);
    });

    it('wraps execution failures with an actionable message', async () => {
        await expect(verifyZoltVersion('/definitely/missing/zolt', '0.3.2'))
            .rejects.toThrow(/Could not execute downloaded Zolt binary/u);
    });
});

async function executable(command: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'setup-zolt-verify-test-'));
    roots.push(root);
    const binary = resolve(root, 'zolt');
    await writeFile(binary, `#!/bin/sh\n${command}\n`);
    await chmod(binary, 0o755);
    return binary;
}
