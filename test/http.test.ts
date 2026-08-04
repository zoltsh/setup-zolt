import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import type { OutgoingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { ActionsHttpTransport, type HttpClientLike, type HttpMessage } from '../src/http';

const roots: string[] = [];

afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })));
});

describe('bounded HTTP transport', () => {
    it('constructs and disposes the production HTTP clients', () => {
        const transport = new ActionsHttpTransport();
        expect(() => {
            transport.dispose();
        }).not.toThrow();
    });

    it('reads metadata and streams archives while hashing', async () => {
        const payload = Buffer.from('verified bytes');
        const metadataClient = new FakeHttpClient([
            response(200, payload, payload.length.toString()),
            response(200, payload, payload.length.toString()),
        ]);
        const archiveClient = new FakeHttpClient([
            response(200, payload, payload.length.toString()),
            response(200, payload, payload.length.toString()),
        ]);
        const transport = new ActionsHttpTransport(metadataClient, archiveClient);
        await expect(transport.read(
            new URL('https://dist.zolt.sh/channels/zap.json'),
            100,
            'current metadata',
        )).resolves.toEqual(payload);
        await expect(transport.read(
            new URL('https://github.com/zoltsh/releases/releases/download/release/channel-zap.json'),
            100,
            'exact metadata',
        )).resolves.toEqual(payload);
        await expect(transport.read(
            new URL('https://github.com.evil.test/channel-zap.json'),
            100,
            'foreign metadata',
        )).resolves.toEqual(payload);
        const root = await temporaryRoot();
        const destination = resolve(root, 'download');
        const result = await transport.download(new URL('https://example.test/archive'), destination, 100, 'fixture');
        expect(result).toEqual({
            bytes: payload.length,
            sha256: createHash('sha256').update(payload).digest('hex'),
        });
        await expect(readFile(destination)).resolves.toEqual(payload);
        expect(metadataClient.requestedUrls).toEqual([
            'https://dist.zolt.sh/channels/zap.json',
            'https://github.com.evil.test/channel-zap.json',
        ]);
        expect(archiveClient.requestedUrls).toEqual([
            'https://github.com/zoltsh/releases/releases/download/release/channel-zap.json',
            'https://example.test/archive',
        ]);
        expect(metadataClient.requestedHeaders).toEqual([
            {
                accept: 'application/octet-stream',
                'accept-encoding': 'identity',
            },
            {
                accept: 'application/octet-stream',
                'accept-encoding': 'identity',
            },
        ]);
        transport.dispose();
        expect(metadataClient.disposed).toBe(true);
        expect(archiveClient.disposed).toBe(true);
    });

    it('rejects HTTP failures and declared or streamed oversize responses', async () => {
        const failed = response(404, Buffer.alloc(0));
        const client = new FakeHttpClient([
            failed,
            response(undefined, Buffer.alloc(0)),
            response(200, Buffer.from('x'), '100'),
            response(200, Buffer.from('too many bytes')),
        ]);
        const transport = new ActionsHttpTransport(client);
        const url = new URL('https://example.test/fixture');
        await expect(transport.read(url, 10, 'fixture')).rejects.toThrow(/expected HTTP 200/u);
        expect(failed.message.destroyed).toBe(true);
        await expect(transport.read(url, 10, 'fixture')).rejects.toThrow(/received no status/u);
        await expect(transport.read(url, 10, 'fixture')).rejects.toThrow(/download limit/u);
        await expect(transport.read(url, 2, 'fixture')).rejects.toThrow(/download limit/u);
    });

    it('rejects malformed content lengths and bounded archive streams', async () => {
        const client = new FakeHttpClient([
            response(200, Buffer.from('x'), 'not-a-number'),
            response(200, Buffer.from('too many bytes')),
        ]);
        const transport = new ActionsHttpTransport(client);
        const url = new URL('https://example.test/fixture');
        await expect(transport.read(url, 10, 'fixture')).rejects.toThrow(/invalid Content-Length/u);
        const root = await temporaryRoot();
        const destination = resolve(root, 'download');
        await expect(transport.download(url, destination, 2, 'fixture')).rejects.toThrow(/download limit/u);
        await expect(readFile(destination)).rejects.toThrow();
    });

    it('rejects repeated content lengths and wraps request failures', async () => {
        const repeated = response(200, Buffer.from('x'), ['1', '1']);
        const transport = new ActionsHttpTransport(new FakeHttpClient([repeated]));
        await expect(transport.read(new URL('https://example.test/fixture'), 10, 'fixture'))
            .rejects.toThrow(/multiple Content-Length/u);
        expect(repeated.message.destroyed).toBe(true);

        const failing = new FailingHttpClient();
        await expect(new ActionsHttpTransport(failing).read(
            new URL('https://example.test/fixture'),
            10,
            'fixture',
        )).rejects.toThrow(/Could not request fixture/u);
        const singleClientTransport = new ActionsHttpTransport(failing);
        singleClientTransport.dispose();
        expect(failing.disposed).toBe(true);
    });

    it('never removes a pre-existing destination', async () => {
        const client = new FakeHttpClient([response(200, Buffer.from('payload'))]);
        const root = await temporaryRoot();
        const destination = resolve(root, 'existing');
        await writeFile(destination, 'keep');
        const transport = new ActionsHttpTransport(client);
        await expect(transport.download(
            new URL('https://example.test/archive'),
            destination,
            100,
            'fixture',
        )).rejects.toThrow();
        await expect(readFile(destination, 'utf8')).resolves.toBe('keep');
    });
});

class FakeHttpClient implements HttpClientLike {
    public disposed = false;
    public readonly requestedUrls: string[] = [];
    public readonly requestedHeaders: Array<OutgoingHttpHeaders | undefined> = [];

    constructor(private readonly responses: Array<{ readonly message: HttpMessage }>) {}

    public dispose(): void {
        this.disposed = true;
    }

    public async get(url: string, headers?: OutgoingHttpHeaders): Promise<{ readonly message: HttpMessage }> {
        this.requestedUrls.push(url);
        this.requestedHeaders.push(headers);
        const next = this.responses.shift();
        if (next === undefined) return Promise.reject(new Error('fake HTTP response queue is empty'));
        return Promise.resolve(next);
    }
}

class FailingHttpClient implements HttpClientLike {
    public disposed = false;

    public dispose(): void {
        this.disposed = true;
    }

    public async get(): Promise<{ readonly message: HttpMessage }> {
        return Promise.reject(new Error('network unavailable'));
    }
}

function response(
    statusCode: number | undefined,
    body: Buffer,
    contentLength?: string | string[],
): { readonly message: HttpMessage & PassThrough } {
    const stream = new PassThrough();
    const message = stream as HttpMessage & PassThrough;
    Object.defineProperties(message, {
        headers: { value: contentLength === undefined ? {} : { 'content-length': contentLength } },
        statusCode: { value: statusCode },
    });
    stream.end(body);
    return { message };
}

async function temporaryRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'setup-zolt-http-test-'));
    roots.push(root);
    return root;
}
