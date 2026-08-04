import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import { dirname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { HttpClient } from '@actions/http-client';

import { SetupZoltError, errorMessage } from './errors';
import type { DownloadResult, Transport } from './types';

const HTTP_OK = 200;
const DOWNLOAD_HEADERS = {
    accept: 'application/octet-stream',
    'accept-encoding': 'identity',
} as const;

export interface HttpMessage extends AsyncIterable<unknown> {
    readonly headers: IncomingHttpHeaders;
    readonly statusCode?: number | undefined;
    destroy(): void;
}

export interface HttpClientLike {
    dispose(): void;
    get(url: string, headers?: OutgoingHttpHeaders): Promise<{ readonly message: HttpMessage }>;
}

export class ActionsHttpTransport implements Transport {
    readonly #archiveClient: HttpClientLike;
    readonly #metadataClient: HttpClientLike;

    constructor(metadataClient?: HttpClientLike, archiveClient?: HttpClientLike) {
        if (metadataClient === undefined) {
            // Signed metadata must come directly from dist.zolt.sh. GitHub may
            // redirect release archives to its asset host; the checksum still
            // pins the downloaded bytes.
            this.#metadataClient = createClient(false);
            this.#archiveClient = archiveClient ?? createClient(true);
            return;
        }
        this.#metadataClient = metadataClient;
        this.#archiveClient = archiveClient ?? metadataClient;
    }

    public async read(url: URL, maximumBytes: number, label: string): Promise<Buffer> {
        const message = await get(this.#metadataClient, url, label);
        assertMessage(message, url, maximumBytes, label);
        const chunks: Buffer[] = [];
        let bytes = 0;
        try {
            for await (const value of message) {
                const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
                bytes += chunk.length;
                if (bytes > maximumBytes) {
                    message.destroy();
                    throw new SetupZoltError(`${label} exceeds the ${maximumBytes.toString()}-byte download limit.`);
                }
                chunks.push(chunk);
            }
        } catch (error) {
            if (error instanceof SetupZoltError) throw error;
            throw new SetupZoltError(`Could not read ${label} from ${url.toString()}.`, { cause: error });
        }
        return Buffer.concat(chunks, bytes);
    }

    public async download(
        url: URL,
        destination: string,
        maximumBytes: number,
        label: string,
    ): Promise<DownloadResult> {
        const message = await get(this.#archiveClient, url, label);
        assertMessage(message, url, maximumBytes, label);
        await mkdir(dirname(destination), { recursive: true });
        const digest = createHash('sha256');
        let bytes = 0;
        const meter = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                bytes += chunk.length;
                if (bytes > maximumBytes) {
                    callback(new SetupZoltError(
                        `${label} exceeds the ${maximumBytes.toString()}-byte download limit.`,
                    ));
                    return;
                }
                digest.update(chunk);
                callback(null, chunk);
            },
        });
        const destinationState = { owned: false };
        const destinationStream = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
        destinationStream.once('open', () => {
            destinationState.owned = true;
        });
        try {
            await pipeline(message, meter, destinationStream);
        } catch (error) {
            const failure = error instanceof SetupZoltError
                ? error
                : new SetupZoltError(`Could not write ${label} to a temporary file.`, { cause: error });
            if (destinationState.owned) {
                try {
                    await rm(destination, { force: true });
                } catch (cleanupError) {
                    throw new SetupZoltError(
                        `${errorMessage(failure)} The incomplete temporary file could not be removed.`,
                        { cause: cleanupError },
                    );
                }
            }
            throw failure;
        }
        return { bytes, sha256: digest.digest('hex') };
    }

    public dispose(): void {
        this.#metadataClient.dispose();
        if (this.#archiveClient !== this.#metadataClient) this.#archiveClient.dispose();
    }
}

function createClient(allowRedirects: boolean): HttpClientLike {
    return new HttpClient('zoltsh/setup-zolt', [], {
        allowRedirectDowngrade: false,
        allowRedirects,
        allowRetries: true,
        keepAlive: true,
        maxRedirects: allowRedirects ? 5 : 0,
        maxRetries: 3,
        socketTimeout: 30_000,
    });
}

async function get(client: HttpClientLike, url: URL, label: string): Promise<HttpMessage> {
    try {
        const response = await client.get(url.toString(), DOWNLOAD_HEADERS);
        return response.message;
    } catch (error) {
        throw new SetupZoltError(`Could not request ${label} from ${url.toString()}.`, { cause: error });
    }
}

function assertMessage(message: HttpMessage, url: URL, maximumBytes: number, label: string): void {
    try {
        assertResponse(message.statusCode, url, label);
        assertContentLength(message.headers['content-length'], maximumBytes, label);
    } catch (error) {
        message.destroy();
        throw error;
    }
}

function assertResponse(statusCode: number | undefined, url: URL, label: string): void {
    if (statusCode !== HTTP_OK) {
        throw new SetupZoltError(
            `Could not download ${label} from ${url.toString()}: expected HTTP 200, received ${statusCode?.toString() ?? 'no status'}.`,
        );
    }
}

function assertContentLength(value: string | string[] | undefined, maximumBytes: number, label: string): void {
    if (value === undefined) return;
    if (Array.isArray(value) && value.length !== 1) {
        throw new SetupZoltError(`${label} returned multiple Content-Length headers.`);
    }
    const text = Array.isArray(value) ? value[0] : value;
    if (text === undefined || !/^\d+$/u.test(text)) {
        throw new SetupZoltError(`${label} returned an invalid Content-Length header.`);
    }
    const bytes = Number(text);
    if (!Number.isSafeInteger(bytes) || bytes > maximumBytes) {
        throw new SetupZoltError(`${label} exceeds the ${maximumBytes.toString()}-byte download limit.`);
    }
}
