import {
    DISTRIBUTION_ORIGIN,
    LATEST_VERSION_SELECTOR,
    MAX_CHANNEL_MANIFEST_BYTES,
    MAX_SIGNATURE_BYTES,
    RELEASE_ASSET_ORIGIN,
    TRUSTED_KEYS,
    ZAP_VERSION_PATTERN,
} from './constants';
import { SetupZoltError } from './errors';
import { decodeUtf8 } from './json';
import { type ParsedReleaseVersion, parseChannelManifest } from './release-schema';
import { verifyReleaseSignature } from './signatures';
import type {
    Channel,
    ReleaseSelection,
    ReleaseTarget,
    Transport,
    TrustedKey,
} from './types';

export { parseChannelManifest } from './release-schema';

export async function resolveRelease(
    transport: Transport,
    channel: Channel,
    version: string,
    target: ReleaseTarget,
    trustedKeys: ReadonlyMap<string, TrustedKey> = TRUSTED_KEYS,
): Promise<ReleaseSelection> {
    const selectedVersion = version === LATEST_VERSION_SELECTOR
        ? await resolveCurrentRelease(transport, channel, trustedKeys)
        : await resolveExactRelease(transport, channel, version, trustedKeys);
    const artifact = selectedVersion.artifacts.find((candidate) => candidate.target === target);
    if (artifact === undefined) {
        throw new SetupZoltError(
            `Zolt version \`${selectedVersion.version}\` does not contain release target \`${target}\`.`,
        );
    }
    return {
        artifact,
        channel,
        commit: selectedVersion.commit,
        createdAt: selectedVersion.createdAt,
        version: selectedVersion.version,
    };
}

export function channelManifestUrl(channel: Channel): URL {
    return new URL(`/channels/${channel}.json`, DISTRIBUTION_ORIGIN);
}

export function exactReleaseManifestUrl(channel: Channel, version: string): URL {
    if (!ZAP_VERSION_PATTERN.test(version)) {
        throw new SetupZoltError(`Cannot build metadata URL for invalid exact ${channel} version \`${version}\`.`);
    }
    return new URL(
        `${RELEASE_ASSET_ORIGIN}/zolt-${channel}-${version}/channel-${channel}.json`,
    );
}

async function resolveCurrentRelease(
    transport: Transport,
    channel: Channel,
    trustedKeys: ReadonlyMap<string, TrustedKey>,
): Promise<ParsedReleaseVersion> {
    const manifest = await readSignedMetadata(
        transport,
        channelManifestUrl(channel),
        MAX_CHANNEL_MANIFEST_BYTES,
        'channel manifest',
        parseChannelManifest,
        trustedKeys,
    );
    return manifest;
}

async function resolveExactRelease(
    transport: Transport,
    channel: Channel,
    version: string,
    trustedKeys: ReadonlyMap<string, TrustedKey>,
): Promise<ParsedReleaseVersion> {
    const manifest = await readSignedMetadata(
        transport,
        exactReleaseManifestUrl(channel, version),
        MAX_CHANNEL_MANIFEST_BYTES,
        'exact release manifest',
        parseChannelManifest,
        trustedKeys,
    );
    if (manifest.version !== version) {
        throw new SetupZoltError(
            `Exact release metadata selected ${manifest.channel} version \`${manifest.version}\`; expected ${channel} version \`${version}\`.`,
        );
    }
    return manifest;
}

async function readSignedMetadata<T>(
    transport: Transport,
    url: URL,
    maximumBytes: number,
    label: string,
    parse: (payload: Buffer) => T,
    trustedKeys: ReadonlyMap<string, TrustedKey>,
): Promise<T> {
    const [payload, signature] = await Promise.all([
        transport.read(url, maximumBytes, label),
        transport.read(signatureUrl(url), MAX_SIGNATURE_BYTES, `${label} signature`),
    ]);
    verifyReleaseSignature(payload, decodeUtf8(signature, `${sentenceCase(label)} signature`), trustedKeys);
    return parse(payload);
}

function signatureUrl(metadataUrl: URL): URL {
    return new URL(`${metadataUrl.toString()}.sig`);
}

function sentenceCase(value: string): string {
    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
