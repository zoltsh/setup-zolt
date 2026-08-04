import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { TRUSTED_KEYS } from '../src/constants';
import { verifyReleaseSignature } from '../src/signatures';
import type { TrustedKey } from '../src/types';
import { signatureFixture } from './helpers';

describe('release signature verification', () => {
    it('verifies Ed25519 metadata with a trusted key', () => {
        const payload = Buffer.from('signed release metadata');
        const fixture = signatureFixture(payload);
        expect(verifyReleaseSignature(payload, fixture.sidecar.toString('utf8'), fixture.trustedKeys))
            .toBe('test-release-key');
        expect(verifyReleaseSignature(
            payload,
            fixture.sidecar.toString('utf8').replaceAll('\n', '\r\n'),
            fixture.trustedKeys,
        )).toBe('test-release-key');
    });

    it('rejects tampering after signing', () => {
        const fixture = signatureFixture(Buffer.from('original'));
        expect(() => verifyReleaseSignature(Buffer.from('tampered'), fixture.sidecar.toString(), fixture.trustedKeys))
            .toThrow(/signature is invalid/u);
    });

    it('rejects unknown keys and algorithms', () => {
        const payload = Buffer.from('metadata');
        const fixture = signatureFixture(payload);
        expect(() => verifyReleaseSignature(payload, fixture.sidecar.toString().replace('test-release-key', 'other'), fixture.trustedKeys))
            .toThrow(/untrusted key/u);
        const trustedKey = fixture.trustedKeys.get('test-release-key');
        if (trustedKey === undefined) throw new Error('signature fixture did not create its trusted key');
        const wrongAlgorithm: Map<string, TrustedKey> = new Map([
            ['test-release-key', { ...trustedKey, algorithm: 'RSA' }],
        ]);
        expect(() => verifyReleaseSignature(payload, fixture.sidecar.toString(), wrongAlgorithm))
            .toThrow(/unsupported algorithm/u);
    });

    it.each([
        '',
        'version: nope\nkeyId: key\nsignature: AA==\n',
        'version: zolt-ed25519-v1\nkeyId: bad key\nsignature: AA==\n',
        'version: zolt-ed25519-v1\nkeyId: key\nsignature: not-base64\n',
        'version: zolt-ed25519-v1\nkeyId: key\nsignature: AA==\nextra: no\n',
    ])('rejects malformed sidecar %#', (sidecar) => {
        expect(() => verifyReleaseSignature(Buffer.alloc(0), sidecar, new Map())).toThrow();
    });

    it('rejects structurally invalid signatures after selecting a trusted key', () => {
        const key: TrustedKey = {
            algorithm: 'Ed25519',
            keyId: 'key',
            x509PublicKeyBase64: 'AAAA',
        };
        const keys = new Map([['key', key]]);
        expect(() => verifyReleaseSignature(
            Buffer.alloc(0),
            'version: zolt-ed25519-v1\nkeyId: key\nsignature: AA==\n',
            keys,
        )).toThrow(/exactly 64 bytes/u);
        expect(() => verifyReleaseSignature(
            Buffer.alloc(0),
            'version: zolt-ed25519-v1\nkeyId: key\nsignature: AB=C\n',
            keys,
        )).toThrow(/canonical base64/u);
        expect(() => verifyReleaseSignature(
            Buffer.alloc(0),
            'version: zolt-ed25519-v1\nkeyId: key\nsignature: \n',
            keys,
        )).toThrow(/missing `signature`/u);
    });

    it('rejects malformed trusted public keys without leaking crypto errors', () => {
        const pair = generateKeyPairSync('ed25519');
        const payload = Buffer.from('metadata');
        const signature = sign(null, payload, pair.privateKey).toString('base64');
        const sidecar = `version: zolt-ed25519-v1\nkeyId: broken\nsignature: ${signature}\n`;
        const keys: Map<string, TrustedKey> = new Map([
            ['broken', { algorithm: 'Ed25519', keyId: 'broken', x509PublicKeyBase64: 'AAAA' }],
        ]);
        expect(() => verifyReleaseSignature(payload, sidecar, keys)).toThrow(/Could not verify release metadata/u);
    });

    it('bundles the public Zolt release trust anchor', () => {
        expect(TRUSTED_KEYS.get('zolt-release-2026')).toMatchObject({ algorithm: 'Ed25519' });
    });
});
