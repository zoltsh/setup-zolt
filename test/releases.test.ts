import { describe, expect, it } from 'vitest';

import {
    channelManifestUrl,
    exactReleaseManifestUrl,
    parseChannelManifest,
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
} from './helpers';

const OTHER_VERSION = '0.1.0-zap.20260729.aaaaaaaaaaaa';

class MetadataTransport implements Transport {
    public readonly reads: string[] = [];

    constructor(
        private readonly payload: Buffer,
        private readonly signature: Buffer,
    ) {}

    public async read(url: URL): Promise<Buffer> {
        this.reads.push(url.toString());
        return Promise.resolve(url.pathname.endsWith('.sig') ? this.signature : this.payload);
    }

    public async download(): Promise<DownloadResult> {
        return Promise.reject(new Error('archive download is outside resolver tests'));
    }
}

describe('signed release resolution', () => {
    it('resolves an exact target from its immutable signed manifest', async () => {
        const payload = Buffer.from(JSON.stringify(validChannel()));
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
            `https://github.com/zoltsh/releases/releases/download/zolt-zap-${FIXTURE_VERSION}/channel-zap.json`,
            `https://github.com/zoltsh/releases/releases/download/zolt-zap-${FIXTURE_VERSION}/channel-zap.json.sig`,
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
        const signed = Buffer.from(JSON.stringify(validChannel()));
        const fixture = signatureFixture(signed);
        const tampered = Buffer.from(signed.toString().replace(FIXTURE_VERSION, OTHER_VERSION));
        await expect(resolveRelease(
            new MetadataTransport(tampered, fixture.sidecar),
            'zap',
            FIXTURE_VERSION,
            FIXTURE_TARGET,
            fixture.trustedKeys,
        )).rejects.toThrow(/signature is invalid/u);
    });

    it('rejects signed metadata for a different exact version', async () => {
        const payload = Buffer.from(JSON.stringify(validChannel(OTHER_VERSION)));
        const fixture = signatureFixture(payload);
        await expect(resolveRelease(
            new MetadataTransport(payload, fixture.sidecar),
            'zap',
            FIXTURE_VERSION,
            FIXTURE_TARGET,
            fixture.trustedKeys,
        )).rejects.toThrow(/selected.*aaaaaaaaaaaa.*expected.*ec2351c87746/u);
    });

    it('rejects a manifest without the runner target', async () => {
        const payload = Buffer.from(JSON.stringify(validChannel()));
        const fixture = signatureFixture(payload);
        await expect(resolveRelease(
            new MetadataTransport(payload, fixture.sidecar),
            'zap',
            FIXTURE_VERSION,
            'macos-x64',
            fixture.trustedKeys,
        )).rejects.toThrow(/does not contain release target/u);
    });

    it('builds only fixed metadata URLs', () => {
        expect(channelManifestUrl('zap').toString()).toBe('https://dist.zolt.sh/channels/zap.json');
        expect(exactReleaseManifestUrl('zap', FIXTURE_VERSION).toString()).toBe(
            `https://github.com/zoltsh/releases/releases/download/zolt-zap-${FIXTURE_VERSION}/channel-zap.json`,
        );
        expect(() => exactReleaseManifestUrl('zap', '../bad')).toThrow(/invalid exact zap version/u);
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

    it('rejects the retired dist.zolt.sh artifact layout', () => {
        const manifest = validChannel();
        const artifact = firstArtifact(manifest);
        artifact.archiveUrl = `https://dist.zolt.sh/artifacts/zap/${FIXTURE_VERSION}/${artifact.archive}`;
        artifact.checksumUrl = `${artifact.archiveUrl}.sha256`;
        expect(() => parse(manifest)).toThrow(/archiveUrl/u);
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
        ['normalized calendar date', (manifest: ReturnType<typeof validChannel>) => {
            manifest.createdAt = '2026-02-31T11:04:26Z';
        }, /timestamp/u],
        ['bad commit', (manifest: ReturnType<typeof validChannel>) => {
            manifest.commit = 'abc';
        }, /40 lowercase/u],
        ['unsafe version', (manifest: ReturnType<typeof validChannel>) => {
            manifest.version = '../bad';
        }, /safe path segment/u],
        ['version from another channel', (manifest: ReturnType<typeof validChannel>) => {
            manifest.version = '1.2.3';
        }, /channel format/u],
        ['version with a leading zero', (manifest: ReturnType<typeof validChannel>) => {
            manifest.version = '01.2.3-zap.20260728.ec2351c87746';
        }, /channel format/u],
        ['unknown target', (manifest: ReturnType<typeof validChannel>) => {
            firstArtifact(manifest).target = 'plan9-x64';
        }, /unsupported target/u],
        ['wrong archive', (manifest: ReturnType<typeof validChannel>) => {
            firstArtifact(manifest).archive = 'zolt.tar.gz';
        }, /archive must be/u],
        ['wrong format', (manifest: ReturnType<typeof validChannel>) => {
            firstArtifact(manifest).format = 'zip';
        }, /format must be/u],
        ['wrong binary', (manifest: ReturnType<typeof validChannel>) => {
            firstArtifact(manifest).binaryName = 'java';
        }, /binaryName/u],
        ['wrong checksum', (manifest: ReturnType<typeof validChannel>) => {
            firstArtifact(manifest).sha256 = 'abc';
        }, /sha256/u],
        ['uppercase checksum', (manifest: ReturnType<typeof validChannel>) => {
            firstArtifact(manifest).sha256 = FIXTURE_SHA256.toUpperCase();
        }, /sha256/u],
        ['foreign archive URL', (manifest: ReturnType<typeof validChannel>) => {
            firstArtifact(manifest).archiveUrl = 'https://evil.example/zolt.tar.gz';
        }, /archiveUrl/u],
        ['foreign checksum URL', (manifest: ReturnType<typeof validChannel>) => {
            firstArtifact(manifest).checksumUrl = 'https://evil.example/zolt.sha256';
        }, /checksumUrl/u],
        ['wrong GitHub repository', (manifest: ReturnType<typeof validChannel>) => {
            const artifact = firstArtifact(manifest);
            artifact.archiveUrl = githubArchiveUrl(FIXTURE_VERSION, artifact.archive)
                .replace('/zoltsh/releases/', '/zoltsh/zolt/');
        }, /archiveUrl/u],
        ['wrong GitHub release tag', (manifest: ReturnType<typeof validChannel>) => {
            const artifact = firstArtifact(manifest);
            artifact.archiveUrl = githubArchiveUrl(FIXTURE_VERSION, artifact.archive)
                .replace('/zolt-zap-', '/v');
        }, /archiveUrl/u],
    ])('rejects %s', (_name, mutate, message) => {
        const manifest = validChannel();
        mutate(manifest);
        expect(() => parse(manifest)).toThrow(message);
    });

    it('rejects unknown fields, missing fields, and empty artifact lists', () => {
        const unknown = Object.assign(validChannel(), { future: true });
        expect(() => parse(unknown)).toThrow(/unsupported field/u);

        const missingVersion = validChannel();
        Reflect.deleteProperty(missingVersion, 'version');
        expect(() => parse(missingVersion)).toThrow(/missing `version`/u);

        const missingChecksum = validChannel();
        Reflect.deleteProperty(firstArtifact(missingChecksum), 'sha256');
        expect(() => parse(missingChecksum)).toThrow(/missing `sha256`/u);

        const missingChecksumUrl = validChannel();
        Reflect.deleteProperty(firstArtifact(missingChecksumUrl), 'checksumUrl');
        expect(() => parse(missingChecksumUrl)).toThrow(/missing `checksumUrl`/u);

        const empty = validChannel();
        empty.artifacts = [];
        expect(() => parse(empty)).toThrow(/between 1 and 4/u);
    });

    it('rejects fields outside the publisher schema and malformed encodings', () => {
        const manifest = validChannel();
        const artifact = firstArtifact(manifest);
        Object.assign(artifact, {
            signature: { kind: 'minisign', url: `${artifact.archiveUrl}.minisig` },
        });
        expect(() => parse(manifest)).toThrow(/unsupported field/u);
        expect(() => parseChannelManifest(Buffer.from('{'))).toThrow(/not valid JSON/u);
        expect(() => parseChannelManifest(Buffer.from([0xc3, 0x28]))).toThrow(/valid UTF-8/u);
    });

    it('rejects duplicate targets, too many artifacts, and control characters', () => {
        const duplicate = validChannel();
        duplicate.artifacts.push(structuredClone(firstArtifact(duplicate)));
        expect(() => parse(duplicate)).toThrow(/repeats target/u);

        const excessive = validChannel();
        excessive.artifacts = Array.from(
            { length: 5 },
            () => structuredClone(firstArtifact(excessive)),
        );
        expect(() => parse(excessive)).toThrow(/between 1 and 4/u);

        const control = validChannel();
        control.version = `bad${String.fromCharCode(1)}version`;
        expect(() => parse(control)).toThrow(/safe path segment/u);
    });
});

function parse(manifest: ReturnType<typeof validChannel>): ReturnType<typeof parseChannelManifest> {
    return parseChannelManifest(Buffer.from(JSON.stringify(manifest)));
}

function firstArtifact(
    manifest: ReturnType<typeof validChannel>,
): ReturnType<typeof validChannel>['artifacts'][number] {
    const artifact = manifest.artifacts[0];
    if (artifact === undefined) throw new Error('fixture is missing its first artifact');
    return artifact;
}
