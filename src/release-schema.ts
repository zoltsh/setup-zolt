import {
    MAX_INDEX_VERSIONS,
    RELEASE_METADATA_SCHEMA_VERSION,
    RELEASE_ASSET_ORIGIN,
    ZAP_VERSION_PATTERN,
} from './constants';
import { SetupZoltError } from './errors';
import { array, exactKeys, integer, object, parseJson, string } from './json';
import type { Channel, ReleaseArtifact, ReleaseTarget } from './types';

const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const RELEASE_TARGETS: Set<ReleaseTarget> = new Set([
    'linux-arm64',
    'linux-x64',
    'macos-arm64',
    'macos-x64',
]);
const RFC3339_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u;

export interface ParsedReleaseVersion {
    readonly artifacts: readonly ReleaseArtifact[];
    readonly commit: string;
    readonly createdAt: string;
    readonly version: string;
}

export interface ParsedReleaseIndex {
    readonly channel: Channel;
    readonly versions: readonly ParsedReleaseVersion[];
}

export interface ParsedChannelManifest extends ParsedReleaseVersion {
    readonly channel: Channel;
}

export function parseReleaseIndex(payload: Buffer): ParsedReleaseIndex {
    const label = 'Release index';
    const root = object(parseJson(payload, label), label);
    exactKeys(root, ['schemaVersion', 'channel', 'updatedAt', 'versions'], [], label);
    schemaVersion(root, label);
    const channel = releaseChannel(root, label);
    timestamp(string(root, 'updatedAt', label), `${label} updatedAt`);
    const versionValues = array(root, 'versions', label);
    if (versionValues.length === 0 || versionValues.length > MAX_INDEX_VERSIONS) {
        throw new SetupZoltError(
            `${label} must contain between 1 and ${MAX_INDEX_VERSIONS.toString()} versions.`,
        );
    }
    const versions = versionValues.map((value, index) =>
        parseReleaseVersion(value, channel, `${label} version ${index.toString()}`),
    );
    unique(versions.map((item) => item.version), `${label} repeats version`);
    return { channel, versions };
}

export function parseChannelManifest(payload: Buffer): ParsedChannelManifest {
    const label = 'Channel manifest';
    const root = object(parseJson(payload, label), label);
    exactKeys(root, ['schemaVersion', 'channel', 'version', 'commit', 'createdAt', 'artifacts'], [], label);
    schemaVersion(root, label);
    const channel = releaseChannel(root, label);
    return { channel, ...parseReleaseFields(root, channel, label) };
}

function parseReleaseVersion(value: unknown, channel: Channel, label: string): ParsedReleaseVersion {
    const record = object(value, label);
    exactKeys(record, ['version', 'commit', 'createdAt', 'artifacts'], [], label);
    return parseReleaseFields(record, channel, label);
}

function parseReleaseFields(
    record: Record<string, unknown>,
    channel: Channel,
    label: string,
): ParsedReleaseVersion {
    const version = safeSegment(string(record, 'version', label), `${label} version`);
    if (!ZAP_VERSION_PATTERN.test(version)) {
        throw new SetupZoltError(`${label} version does not match the \`${channel}\` channel format.`);
    }
    const commit = string(record, 'commit', label);
    if (!COMMIT.test(commit)) throw new SetupZoltError(`${label} commit must be 40 lowercase hexadecimal characters.`);
    const createdAt = string(record, 'createdAt', label);
    timestamp(createdAt, `${label} createdAt`);
    const artifactValues = array(record, 'artifacts', label);
    if (artifactValues.length === 0 || artifactValues.length > RELEASE_TARGETS.size) {
        throw new SetupZoltError(
            `${label} must contain between 1 and ${RELEASE_TARGETS.size.toString()} artifacts.`,
        );
    }
    const artifacts = artifactValues.map((artifact, index) =>
        parseArtifact(artifact, version, `${label} artifact ${index.toString()}`),
    );
    unique(artifacts.map((artifact) => artifact.target), `${label} repeats target`);
    return { artifacts, commit, createdAt, version };
}

function parseArtifact(value: unknown, version: string, label: string): ReleaseArtifact {
    const record = object(value, label);
    exactKeys(
        record,
        ['target', 'archive', 'archiveUrl', 'checksumUrl', 'sha256', 'format', 'binaryName'],
        [],
        label,
    );
    const targetValue = string(record, 'target', label);
    if (!RELEASE_TARGETS.has(targetValue as ReleaseTarget)) {
        throw new SetupZoltError(`${label} has unsupported target \`${targetValue}\`.`);
    }
    const target = targetValue as ReleaseTarget;
    const archive = safeSegment(string(record, 'archive', label), `${label} archive`);
    const expectedArchive = `zolt-${version}-${target}.tar.gz`;
    if (archive !== expectedArchive) {
        throw new SetupZoltError(`${label} archive must be \`${expectedArchive}\`.`);
    }
    if (string(record, 'format', label) !== 'tar.gz') {
        throw new SetupZoltError(`${label} format must be \`tar.gz\`.`);
    }
    if (string(record, 'binaryName', label) !== 'zolt') {
        throw new SetupZoltError(`${label} binaryName must be \`zolt\`.`);
    }
    const sha256 = string(record, 'sha256', label);
    if (!SHA256.test(sha256)) throw new SetupZoltError(`${label} sha256 must be 64 hexadecimal characters.`);
    const archiveUrl = string(record, 'archiveUrl', label);
    const expectedUrl = releaseArtifactUrl(version, archive);
    if (archiveUrl !== expectedUrl) {
        throw new SetupZoltError(
            `${label} archiveUrl must be the immutable Zolt release asset \`${expectedUrl}\`.`,
        );
    }
    if (string(record, 'checksumUrl', label) !== `${archiveUrl}.sha256`) {
        throw new SetupZoltError(`${label} checksumUrl must be \`${archiveUrl}.sha256\`.`);
    }
    return {
        archive,
        archiveUrl,
        binaryName: 'zolt',
        format: 'tar.gz',
        sha256,
        target,
    };
}

function releaseArtifactUrl(version: string, archive: string): string {
    return `${RELEASE_ASSET_ORIGIN}/zolt-zap-${version}/${archive}`;
}

function schemaVersion(record: Record<string, unknown>, label: string): void {
    const value = integer(record, 'schemaVersion', label);
    if (value !== RELEASE_METADATA_SCHEMA_VERSION) {
        throw new SetupZoltError(
            `${label} has unsupported schemaVersion ${value.toString()}; expected ${RELEASE_METADATA_SCHEMA_VERSION.toString()}.`,
        );
    }
}

function releaseChannel(record: Record<string, unknown>, label: string): Channel {
    const channel = string(record, 'channel', label);
    if (channel !== 'zap') throw new SetupZoltError(`${label} has unsupported channel \`${channel}\`.`);
    return channel;
}

function safeSegment(value: string, label: string): string {
    if (
        value.length > 256
        || value.trim() !== value
        || value.includes('..')
        || value.includes('/')
        || value.includes('\\')
        || value.includes(':')
        || containsControlCharacter(value)
    ) {
        throw new SetupZoltError(`${label} must be one safe path segment.`);
    }
    return value;
}

function containsControlCharacter(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 31 || code === 127) return true;
    }
    return false;
}

function timestamp(value: string, label: string): void {
    const match = RFC3339_UTC.exec(value);
    if (match === null) throw new SetupZoltError(`${label} must be an RFC 3339 UTC timestamp.`);
    const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
    const epoch = Date.parse(value);
    const parsed = new Date(epoch);
    if (
        year === undefined
        || month === undefined
        || day === undefined
        || hour === undefined
        || minute === undefined
        || second === undefined
        || year === 0
        || Number.isNaN(epoch)
        || parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() + 1 !== month
        || parsed.getUTCDate() !== day
        || parsed.getUTCHours() !== hour
        || parsed.getUTCMinutes() !== minute
        || parsed.getUTCSeconds() !== second
    ) {
        throw new SetupZoltError(`${label} must be an RFC 3339 UTC timestamp.`);
    }
}

function unique(values: readonly string[], message: string): void {
    if (new Set(values).size !== values.length) throw new SetupZoltError(`${message} \`${duplicate(values)}\`.`);
}

function duplicate(values: readonly string[]): string {
    const seen: Set<string> = new Set();
    for (const value of values) {
        if (seen.has(value)) return value;
        seen.add(value);
    }
    throw new SetupZoltError('Internal error while locating duplicate release metadata.');
}
