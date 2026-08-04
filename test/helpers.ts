import { generateKeyPairSync, sign } from 'node:crypto';

import type { TrustedKey } from '../src/types';

export const FIXTURE_VERSION = '0.1.0-zap.20260728.ec2351c87746';
export const FIXTURE_SHA256 = '466b8d45f69781c81ba4851a70cc9682c27debeac5e9917f6d16346cdab37e42';
export const FIXTURE_TARGET = 'linux-x64';
export const FIXTURE_ARCHIVE = `zolt-${FIXTURE_VERSION}-${FIXTURE_TARGET}.tar.gz`;

export interface ChannelFixture {
    artifacts: Array<{
        archive: string;
        archiveUrl: string;
        binaryName: string;
        checksumUrl: string;
        format: string;
        sha256: string;
        target: string;
    }>;
    channel: string;
    commit: string;
    createdAt: string;
    schemaVersion: number;
    version: string;
}

export function validChannel(version = FIXTURE_VERSION): ChannelFixture {
    const archive = `zolt-${version}-${FIXTURE_TARGET}.tar.gz`;
    const archiveUrl = githubArchiveUrl(version, archive);
    return {
        artifacts: [
            {
                archive,
                archiveUrl,
                binaryName: 'zolt',
                checksumUrl: `${archiveUrl}.sha256`,
                format: 'tar.gz',
                sha256: FIXTURE_SHA256,
                target: FIXTURE_TARGET,
            },
        ],
        channel: 'zap',
        commit: 'ec2351c8774658f8790b47ea8081b7b8d1343938',
        createdAt: '2026-07-28T11:04:26Z',
        schemaVersion: 1,
        version,
    };
}

export function githubArchiveUrl(version: string, archive: string): string {
    return `https://github.com/zoltsh/releases/releases/download/zolt-zap-${version}/${archive}`;
}

export function signatureFixture(payload: Buffer, keyId = 'test-release-key'): {
    readonly sidecar: Buffer;
    readonly trustedKeys: ReadonlyMap<string, TrustedKey>;
} {
    const pair = generateKeyPairSync('ed25519');
    const signature = sign(null, payload, pair.privateKey).toString('base64');
    const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const key: TrustedKey = { algorithm: 'Ed25519', keyId, x509PublicKeyBase64: publicKey };
    return {
        sidecar: Buffer.from(
            `version: zolt-ed25519-v1\nkeyId: ${keyId}\nsignature: ${signature}\n`,
            'utf8',
        ),
        trustedKeys: new Map([[keyId, key]]),
    };
}
