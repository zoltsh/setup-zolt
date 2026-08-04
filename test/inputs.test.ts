import { describe, expect, it } from 'vitest';

import { readInputs, requireChannel, requireSha256, requireVersion } from '../src/inputs';
import { FIXTURE_SHA256, FIXTURE_VERSION } from './helpers';

describe('action inputs', () => {
    it('reads and normalizes the exact public contract', () => {
        const values = new Map([
            ['channel', ' zap '],
            ['sha256', FIXTURE_SHA256.toUpperCase()],
            ['version', ` ${FIXTURE_VERSION} `],
        ]);
        const result = readInputs({ getInput: (name) => values.get(name) ?? '' });
        expect(result).toEqual({ channel: 'zap', sha256: FIXTURE_SHA256, version: FIXTURE_VERSION });
    });

    it('defaults an empty channel to zap', () => {
        expect(requireChannel('')).toBe('zap');
    });

    it('allows an explicit latest selection without a caller checksum', () => {
        const values = new Map([
            ['channel', 'zap'],
            ['version', 'latest'],
        ]);
        const result = readInputs({ getInput: (name) => values.get(name) ?? '' });
        expect(result).toEqual({ channel: 'zap', sha256: undefined, version: 'latest' });
    });

    it('requires a caller checksum for an exact version', () => {
        const values = new Map([
            ['channel', 'zap'],
            ['version', FIXTURE_VERSION],
        ]);
        expect(() => readInputs({ getInput: (name) => values.get(name) ?? '' })).toThrow(
            /sha256.*required.*exact/u,
        );
    });

    it.each(['stable', 'nightly', 'preview', 'latest', '../zap'])('rejects unsupported channel %s', (value) => {
        expect(() => requireChannel(value)).toThrow(/Unsupported release channel/u);
    });

    it.each(['', 'abc', `${'0'.repeat(63)}g`, '0'.repeat(65)])('rejects malformed digest %s', (value) => {
        expect(() => requireSha256(value)).toThrow(/64 hexadecimal/u);
    });

    it.each(['', '0.3.2', '0.3.2-rc.1', '01.2.3-zap.20260728.ec2351c87746', '../0.1.0', '0.1.0/evil', 'v'.repeat(129)])(
        'rejects unsupported or unsafe version %s',
        (value) => {
            expect(() => requireVersion(value)).toThrow(/latest.*exact zap version/u);
        },
    );

    it('accepts an exact zap version', () => {
        expect(requireVersion(FIXTURE_VERSION)).toBe(FIXTURE_VERSION);
    });

    it('accepts latest as an explicit version selection', () => {
        expect(requireVersion(' latest ')).toBe('latest');
    });
});
