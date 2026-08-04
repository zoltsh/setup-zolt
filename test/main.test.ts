import { describe, expect, it, vi } from 'vitest';

import type { ActionCore, DisposableTransport } from '../src/main';
import { runAction } from '../src/main';
import type { DownloadResult } from '../src/types';
import { FIXTURE_SHA256, FIXTURE_VERSION } from './helpers';

describe('GitHub Actions adapter', () => {
    it('maps a successful installation to PATH, outputs, and useful logs', async () => {
        const actionCore = new FakeCore({
            channel: 'zap',
            sha256: FIXTURE_SHA256,
            version: FIXTURE_VERSION,
        });
        const transport = new FakeTransport();
        const install = vi.fn(async () => Promise.resolve({
            binary: '/cache/zolt/bin/zolt',
            cacheHit: false,
            sha256: FIXTURE_SHA256,
            target: 'linux-x64' as const,
            version: FIXTURE_VERSION,
        }));
        await runAction({
            architecture: 'x64',
            core: actionCore,
            install,
            platform: 'linux',
            transport,
        });
        expect(actionCore.failed).toEqual([]);
        expect(actionCore.paths).toEqual(['/cache/zolt/bin']);
        expect(actionCore.outputs).toEqual(new Map([
            ['version', FIXTURE_VERSION],
            ['target', 'linux-x64'],
            ['path', '/cache/zolt/bin/zolt'],
            ['sha256', FIXTURE_SHA256],
        ]));
        expect(actionCore.messages).toEqual([
            `Resolving exact Zolt ${FIXTURE_VERSION} for linux-x64 from channel zap.`,
            `Installed Zolt ${FIXTURE_VERSION} for linux-x64; SHA-256 ${FIXTURE_SHA256}.`,
        ]);
        expect(transport.disposed).toBe(true);
    });

    it('fails cleanly on invalid input and still disposes resources', async () => {
        const actionCore = new FakeCore({ channel: 'zap', sha256: 'bad', version: FIXTURE_VERSION });
        const transport = new FakeTransport();
        await runAction({ core: actionCore, transport });
        expect(actionCore.failed).toEqual(['Input `sha256` must be exactly 64 hexadecimal characters.']);
        expect(actionCore.outputs.size).toBe(0);
        expect(transport.disposed).toBe(true);
    });

    it('identifies a verified cache hit in the action log', async () => {
        const actionCore = new FakeCore({
            channel: 'zap',
            sha256: FIXTURE_SHA256,
            version: FIXTURE_VERSION,
        });
        await runAction({
            architecture: 'x64',
            core: actionCore,
            install: async () => Promise.resolve({
                binary: '/cache/zolt/bin/zolt',
                cacheHit: true,
                sha256: FIXTURE_SHA256,
                target: 'linux-x64',
                version: FIXTURE_VERSION,
            }),
            platform: 'linux',
            transport: new FakeTransport(),
        });
        expect(actionCore.messages.at(-1)).toBe(
            `Using cached Zolt ${FIXTURE_VERSION} for linux-x64; SHA-256 ${FIXTURE_SHA256}.`,
        );
    });

    it('reports latest as a moving selection and outputs the resolved version', async () => {
        const actionCore = new FakeCore({ channel: 'zap', version: 'latest' });
        await runAction({
            architecture: 'x64',
            core: actionCore,
            install: async () => Promise.resolve({
                binary: '/cache/zolt/bin/zolt',
                cacheHit: false,
                sha256: FIXTURE_SHA256,
                target: 'linux-x64',
                version: FIXTURE_VERSION,
            }),
            platform: 'linux',
            transport: new FakeTransport(),
        });
        expect(actionCore.failed).toEqual([]);
        expect(actionCore.messages[0]).toBe('Resolving the latest Zolt for linux-x64 from signed channel zap.');
        expect(actionCore.outputs.get('version')).toBe(FIXTURE_VERSION);
        expect(actionCore.outputs.get('sha256')).toBe(FIXTURE_SHA256);
    });

    it('reports disposal failures without rejecting the adapter', async () => {
        const actionCore = new FakeCore({ channel: 'zap', sha256: 'bad', version: FIXTURE_VERSION });
        const transport = new FakeTransport();
        transport.disposeError = new Error('dispose failed');
        await expect(runAction({ core: actionCore, transport })).resolves.toBeUndefined();
        expect(actionCore.failed).toEqual([
            'Input `sha256` must be exactly 64 hexadecimal characters.',
            'Could not dispose HTTP resources: dispose failed',
        ]);
    });
});

class FakeCore implements ActionCore {
    public readonly failed: Array<string | Error> = [];
    public readonly messages: string[] = [];
    public readonly outputs: Map<string, unknown> = new Map();
    public readonly paths: string[] = [];

    constructor(private readonly inputs: Readonly<Record<string, string>>) {}

    public addPath(path: string): void {
        this.paths.push(path);
    }

    public getInput(name: string): string {
        return this.inputs[name] ?? '';
    }

    public info(message: string): void {
        this.messages.push(message);
    }

    public setFailed(message: string | Error): void {
        this.failed.push(message);
    }

    public setOutput(name: string, value: unknown): void {
        this.outputs.set(name, value);
    }
}

class FakeTransport implements DisposableTransport {
    public disposed = false;
    public disposeError?: Error;

    public dispose(): void {
        this.disposed = true;
        if (this.disposeError !== undefined) throw this.disposeError;
    }

    public async download(): Promise<DownloadResult> {
        return Promise.reject(new Error('not used'));
    }

    public async read(): Promise<Buffer> {
        return Promise.reject(new Error('not used'));
    }
}
