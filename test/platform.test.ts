import { describe, expect, it } from 'vitest';

import { resolveTarget } from '../src/platform';

describe('runner target resolution', () => {
    it.each([
        ['linux', 'x64', 'linux-x64'],
        ['linux', 'arm64', 'linux-arm64'],
        ['darwin', 'x64', 'macos-x64'],
        ['darwin', 'arm64', 'macos-arm64'],
    ] as const)('maps %s/%s to %s', (platform, architecture, expected) => {
        expect(resolveTarget(platform, architecture)).toBe(expected);
    });

    it('explains the deliberate Windows boundary', () => {
        expect(() => resolveTarget('win32', 'x64')).toThrow(/Windows runners are not supported yet/u);
    });

    it('rejects every other platform tuple', () => {
        expect(() => resolveTarget('linux', 'ia32')).toThrow(/Unsupported runner platform linux\/ia32/u);
    });
});
