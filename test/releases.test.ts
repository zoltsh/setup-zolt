import { describe, expect, it } from 'vitest';

import {
    channelManifestUrl,
    parseChannelManifest,
    parseReleaseIndex,
    releaseIndexUrl,
    resolveRelease,
} from '../src/releases';
import type { DownloadResult, Transport } from '../src/types';
import {
    FIXTURE_ARCHIVE,
    FIXTURE_SHA256,
    FIXTURE_TARGET,
    FIXTURE_VERSION,
    githubArchiveUrl,
    signatureFixture,
    validChannel,
    validIndex,
} from './helpers';

class MetadataTransport implements Transport {
    public readonly reads: string[] = [];

    constructor(
        private readonly index: Buffer,
        private readonly signature: Buffer,
    ) {}

    public async read(url: URL): Promise<Buffer> {
        this.reads.push(url.toString());
        return Promise.resolve(url.pathname.endsWith('.sig') ? this.signature : this.index);
    }

    public async download(): Promise<DownloadResult> {
        return Promise.reject(new Error('archive download is outside resolver tests'));
    }
}

describe('signed release resolution', () => {
    it('resolves one exact target from a signed index', async () => {
        const payload = Buffer.from(JSON.stringify(validIndex()));
        const fixture = signatureFixture(payload);
        const transport = new MetadataTransport(payload, fixture.sidecar);
        const result = await resolveRelease(
            transport,
            'zap',
            FIXTURE_VERSION,
            FIXTURE_TARGET,
            fixture.trustedKeys,
        );
        expect(result).toEqual({
            artifact: {
                archive: FIXTURE_ARCHIVE,
                archiveUrl: githubArchiveUrl(FIXTURE_VERSION, FIXTURE_ARCHIVE),
                binaryName: 'zolt',
                format: 'tar.gz',
                sha256: FIXTURE_SHA256,
                target: FIXTURE_TARGET,
            },
            channel: 'zap',
            commit: 'ec2351c8774658f8790b47ea8081b7b8d1343938',
            createdAt: '2026-07-28T11:04:26Z',
            version: FIXTURE_VERSION,
        });
        expect(transport.reads).toEqual([
            'https://dist.zolt.sh/releases/zap.json',
            'https://dist.zolt.sh/releases/zap.json.sig',
        ]);
    });

    it('resolves latest from the signed channel manifest only', async () => {
        const payload = Buffer.from(JSON.stringify(validChannel()));
        const fixture = signatureFixture(payload);
        const transport = new MetadataTransport(payload, fixture.sidecar);
        const result = await resolveRelease(
            transport,
            'zap',
            'latest',
            FIXTURE_TARGET,
            fixture.trustedKeys,
        );
        expect(result.version).toBe(FIXTURE_VERSION);
        expect(result.artifact.sha256).toBe(FIXTURE_SHA256);
        expect(transport.reads).toEqual([
            'https://dist.zolt.sh/channels/zap.json',
            'https://dist.zolt.sh/channels/zap.json.sig',
        ]);
    });

    it('verifies the raw bytes before parsing them', async () => {
        const signed = Buffer.from(JSON.stringify(validIndex()));
        const fixture = signatureFixture(signed);
        const tampered = Buffer.from(signed.toString().replace(FIXTURE_VERSION, '0.0.0'));
        await expect(resolveRelease(
            new MetadataTransport(tampered, fixture.sidecar),
            'zap',
            FIXTURE_VERSION,
            FIXTURE_TARGET,
            fixture.trustedKeys,
        )).rejects.toThrow(/signature is invalid/u);
    });

    it('rejects missing versions and targets', async () => {
        const payload = Buffer.from(JSON.stringify(validIndex()));
        const fixture = signatureFixture(payload);
        const transport = new MetadataTransport(payload, fixture.sidecar);
        await expect(resolveRelease(transport, 'zap', '0.0.1', FIXTURE_TARGET, fixture.trustedKeys))
            .rejects.toThrow(/does not contain exact/u);
        await expect(resolveRelease(transport, 'zap', FIXTURE_VERSION, 'macos-x64', fixture.trustedKeys))
            .rejects.toThrow(/does not contain release target/u);
    });

    it('builds only the fixed distribution index URL', () => {
        expect(releaseIndexUrl('zap').toString()).toBe('https://dist.zolt.sh/releases/zap.json');
        expect(channelManifestUrl('zap').toString()).toBe('https://dist.zolt.sh/channels/zap.json');
    });

    it('reports the resolved version when latest lacks the runner target', async () => {
        const payload = Buffer.from(JSON.stringify(validChannel()));
        const fixture = signatureFixture(payload);
        await expect(resolveRelease(
            new MetadataTransport(payload, fixture.sidecar),
            'zap',
            'latest',
            'macos-x64',
            fixture.trustedKeys,
        )).rejects.toThrow(new RegExp(FIXTURE_VERSION.replaceAll('.', '\\.'), 'u'));
    });
});

describe('channel manifest validation', () => {
    it('accepts the exact public schema', () => {
        const manifest = parseChannelManifest(Buffer.from(JSON.stringify(validChannel())));
        expect(manifest).toMatchObject({ channel: 'zap', version: FIXTURE_VERSION });
    });

    it.each([
        ['unsupported schema', (manifest: ReturnType<typeof validChannel>) => {
            manifest.schemaVersion = 2;
        }, /schemaVersion/u],
        ['unsupported channel', (manifest: ReturnType<typeof validChannel>) => {
            manifest.channel = 'preview';
        }, /unsupported channel/u],
        ['bad timestamp', (manifest: ReturnType<typeof validChannel>) => {
            manifest.createdAt = 'today';
        }, /timestamp/u],
        ['unsafe release URL', (manifest: ReturnType<typeof validChannel>) => {
            const artifact = manifest.artifacts[0];
            if (artifact === undefined) throw new Error('fixture is missing its first artifact');
            artifact.archiveUrl = 'https://evil.example/zolt.tar.gz';
        }, /archiveUrl/u],
    ])('rejects %s', (_name, mutate, message) => {
        const manifest = validChannel();
        mutate(manifest);
        expect(() => parseChannelManifest(Buffer.from(JSON.stringify(manifest)))).toThrow(message);
    });

    it('rejects unknown and missing fields', () => {
        const unknown = Object.assign(validChannel(), { future: true });
        expect(() => parseChannelManifest(Buffer.from(JSON.stringify(unknown)))).toThrow(/unsupported field/u);
        const missing = validChannel();
        Reflect.deleteProperty(missing, 'version');
        expect(() => parseChannelManifest(Buffer.from(JSON.stringify(missing)))).toThrow(/missing `version`/u);
    });
});

describe('release index validation', () => {
    it('accepts the exact public schema', () => {
        expect(parseReleaseIndex(Buffer.from(JSON.stringify(validIndex()))).channel).toBe('zap');
    });

    it('rejects the retired dist.zolt.sh artifact layout', () => {
        const index = validIndex();
        const artifact = firstArtifact(index);
        artifact.archiveUrl = `https://dist.zolt.sh/artifacts/zap/${FIXTURE_VERSION}/${artifact.archive}`;
        artifact.checksumUrl = `${artifact.archiveUrl}.sha256`;
        expect(() => parseReleaseIndex(Buffer.from(JSON.stringify(index)))).toThrow(/archiveUrl/u);
    });

    it.each([
        ['unsupported schema', (index: ReturnType<typeof validIndex>) => {
            index.schemaVersion = 2;
        }, /schemaVersion/u],
        ['bad timestamp', (index: ReturnType<typeof validIndex>) => {
            index.updatedAt = 'today';
        }, /timestamp/u],
        ['normalized calendar date', (index: ReturnType<typeof validIndex>) => {
            index.updatedAt = '2026-02-31T11:04:26Z';
        }, /timestamp/u],
        ['unsupported channel', (index: ReturnType<typeof validIndex>) => {
            index.channel = 'preview';
        }, /unsupported channel/u],
        ['bad commit', (index: ReturnType<typeof validIndex>) => {
            firstVersion(index).commit = 'abc';
        }, /40 lowercase/u],
        ['unsafe version', (index: ReturnType<typeof validIndex>) => {
            firstVersion(index).version = '../bad';
        }, /safe path segment/u],
        ['version from another channel', (index: ReturnType<typeof validIndex>) => {
            firstVersion(index).version = '1.2.3';
        }, /channel format/u],
        ['version with a leading zero', (index: ReturnType<typeof validIndex>) => {
            firstVersion(index).version = '01.2.3-zap.20260728.ec2351c87746';
        }, /channel format/u],
        ['unknown target', (index: ReturnType<typeof validIndex>) => {
            firstArtifact(index).target = 'plan9-x64';
        }, /unsupported target/u],
        ['wrong archive', (index: ReturnType<typeof validIndex>) => {
            firstArtifact(index).archive = 'zolt.tar.gz';
        }, /archive must be/u],
        ['wrong format', (index: ReturnType<typeof validIndex>) => {
            firstArtifact(index).format = 'zip';
        }, /format must be/u],
        ['wrong binary', (index: ReturnType<typeof validIndex>) => {
            firstArtifact(index).binaryName = 'java';
        }, /binaryName/u],
        ['wrong checksum', (index: ReturnType<typeof validIndex>) => {
            firstArtifact(index).sha256 = 'abc';
        }, /sha256/u],
        ['uppercase checksum', (index: ReturnType<typeof validIndex>) => {
            firstArtifact(index).sha256 = FIXTURE_SHA256.toUpperCase();
        }, /sha256/u],
        ['foreign archive URL', (index: ReturnType<typeof validIndex>) => {
            firstArtifact(index).archiveUrl = 'https://evil.example/zolt.tar.gz';
        }, /archiveUrl/u],
        ['foreign checksum URL', (index: ReturnType<typeof validIndex>) => {
            firstArtifact(index).checksumUrl = 'https://evil.example/zolt.sha256';
        }, /checksumUrl/u],
        ['wrong GitHub repository', (index: ReturnType<typeof validIndex>) => {
            const artifact = firstArtifact(index);
            artifact.archiveUrl = githubArchiveUrl(FIXTURE_VERSION, artifact.archive)
                .replace('/zoltsh/releases/', '/zoltsh/zolt/');
        }, /archiveUrl/u],
        ['wrong GitHub release tag', (index: ReturnType<typeof validIndex>) => {
            const artifact = firstArtifact(index);
            artifact.archiveUrl = githubArchiveUrl(FIXTURE_VERSION, artifact.archive)
                .replace('/zolt-zap-', '/v');
        }, /archiveUrl/u],
    ])('rejects %s', (_name, mutate, message) => {
        const index = validIndex();
        mutate(index);
        expect(() => parseReleaseIndex(Buffer.from(JSON.stringify(index)))).toThrow(message);
    });

    it('rejects unknown fields, missing fields, duplicates, and empty arrays', () => {
        const unknown = Object.assign(validIndex(), { future: true });
        expect(() => parseReleaseIndex(Buffer.from(JSON.stringify(unknown)))).toThrow(/unsupported field/u);
        const missing = validIndex();
        Reflect.deleteProperty(firstArtifact(missing), 'sha256');
        expect(() => parseReleaseIndex(Buffer.from(JSON.stringify(missing)))).toThrow(/missing `sha256`/u);
        const missingChecksumUrl = validIndex();
        Reflect.deleteProperty(firstArtifact(missingChecksumUrl), 'checksumUrl');
        expect(() => parseReleaseIndex(Buffer.from(JSON.stringify(missingChecksumUrl))))
            .toThrow(/missing `checksumUrl`/u);
        const duplicate = validIndex();
        duplicate.versions.push(structuredClone(firstVersion(duplicate)));
        expect(() => parseReleaseIndex(Buffer.from(JSON.stringify(duplicate)))).toThrow(/repeats version/u);
        const empty = validIndex();
        empty.versions = [];
        expect(() => parseReleaseIndex(Buffer.from(JSON.stringify(empty)))).toThrow(/between 1 and 200/u);
    });

    it('rejects fields outside the publisher schema and malformed encodings', () => {
        const index = validIndex();
        const artifact = firstArtifact(index);
        Object.assign(artifact, {
            signature: { kind: 'minisign', url: `${artifact.archiveUrl}.minisig` },
        });
        expect(() => parseReleaseIndex(Buffer.from(JSON.stringify(index)))).toThrow(/unsupported field/u);
        expect(() => parseReleaseIndex(Buffer.from('{'))).toThrow(/not valid JSON/u);
        expect(() => parseReleaseIndex(Buffer.from([0xc3, 0x28]))).toThrow(/valid UTF-8/u);
    });

    it('rejects duplicate targets and control characters', () => {
        const duplicate = validIndex();
        firstVersion(duplicate).artifacts.push(structuredClone(firstArtifact(duplicate)));
        expect(() => parseReleaseIndex(Buffer.from(JSON.stringify(duplicate)))).toThrow(/repeats target/u);
        const control = validIndex();
        firstVersion(control).version = `bad${String.fromCharCode(1)}version`;
        expect(() => parseReleaseIndex(Buffer.from(JSON.stringify(control)))).toThrow(/safe path segment/u);
    });
});

function firstVersion(index: ReturnType<typeof validIndex>): ReturnType<typeof validIndex>['versions'][number] {
    const version = index.versions[0];
    if (version === undefined) throw new Error('fixture is missing its first version');
    return version;
}

function firstArtifact(
    index: ReturnType<typeof validIndex>,
): ReturnType<typeof validIndex>['versions'][number]['artifacts'][number] {
    const artifact = firstVersion(index).artifacts[0];
    if (artifact === undefined) throw new Error('fixture is missing its first artifact');
    return artifact;
}
