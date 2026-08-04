import { createPublicKey, verify } from 'node:crypto';

import { TRUSTED_KEYS } from './constants';
import { SetupZoltError } from './errors';
import type { TrustedKey } from './types';

const SIDECAR_VERSION = 'zolt-ed25519-v1';
const KEY_ID = /^[A-Za-z0-9._-]{1,128}$/u;

interface SignatureSidecar {
    readonly keyId: string;
    readonly signature: Buffer;
}

export function verifyReleaseSignature(
    payload: Buffer,
    sidecarText: string,
    trustedKeys: ReadonlyMap<string, TrustedKey> = TRUSTED_KEYS,
): string {
    const sidecar = parseSidecar(sidecarText);
    const key = trustedKeys.get(sidecar.keyId);
    if (key === undefined) {
        throw new SetupZoltError(`Release metadata is signed by untrusted key \`${sidecar.keyId}\`.`);
    }
    if (key.algorithm !== 'Ed25519') {
        throw new SetupZoltError(`Trusted release key \`${key.keyId}\` uses unsupported algorithm \`${key.algorithm}\`.`);
    }

    try {
        const publicKey = createPublicKey({
            format: 'der',
            key: Buffer.from(key.x509PublicKeyBase64, 'base64'),
            type: 'spki',
        });
        if (!verify(null, payload, publicKey, sidecar.signature)) {
            throw new SetupZoltError(`Release metadata signature is invalid for key \`${key.keyId}\`.`);
        }
    } catch (error) {
        if (error instanceof SetupZoltError) throw error;
        throw new SetupZoltError(`Could not verify release metadata with key \`${key.keyId}\`.`, { cause: error });
    }
    return key.keyId;
}

function parseSidecar(value: string): SignatureSidecar {
    const lines = value.replace(/\r?\n$/u, '').split(/\r?\n/u);
    if (lines.length !== 3) {
        throw new SetupZoltError('Release metadata signature sidecar must contain exactly three fields.');
    }
    const version = field(lines[0], 'version');
    const keyId = field(lines[1], 'keyId');
    const signatureText = field(lines[2], 'signature');
    if (version !== SIDECAR_VERSION) {
        throw new SetupZoltError(`Unsupported release metadata signature version \`${version}\`.`);
    }
    if (!KEY_ID.test(keyId)) {
        throw new SetupZoltError('Release metadata signature keyId is malformed.');
    }
    const signature = decodeBase64(signatureText);
    if (signature.length !== 64) {
        throw new SetupZoltError('Release metadata Ed25519 signature must be exactly 64 bytes.');
    }
    return { keyId, signature };
}

function field(line: string | undefined, name: string): string {
    const prefix = `${name}: `;
    if (line === undefined || !line.startsWith(prefix) || line.length === prefix.length) {
        throw new SetupZoltError(`Release metadata signature sidecar is missing \`${name}\`.`);
    }
    return line.slice(prefix.length);
}

function decodeBase64(value: string): Buffer {
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value) || value.length % 4 !== 0) {
        throw new SetupZoltError('Release metadata signature is not canonical base64.');
    }
    const decoded = Buffer.from(value, 'base64');
    if (decoded.toString('base64') !== value) {
        throw new SetupZoltError('Release metadata signature is not canonical base64.');
    }
    return decoded;
}
