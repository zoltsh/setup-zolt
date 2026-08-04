import type { Channel, TrustedKey } from './types';

export const DISTRIBUTION_ORIGIN = 'https://dist.zolt.sh';
export const RELEASE_ASSET_ORIGIN = 'https://github.com/zoltsh/releases/releases/download';
export const RELEASE_METADATA_SCHEMA_VERSION = 1;
export const LATEST_VERSION_SELECTOR = 'latest';
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_ARCHIVE_DECOMPRESSION_RATIO = 100;
export const MAX_ARCHIVE_ENTRIES = 10_000;
export const MAX_ARCHIVE_ENTRY_BYTES = 256 * 1024 * 1024;
export const MAX_CACHE_MARKER_BYTES = 4 * 1024;
export const MAX_CHANNEL_MANIFEST_BYTES = 64 * 1024;
export const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;
export const MAX_INDEX_BYTES = 2 * 1024 * 1024;
export const MAX_INDEX_VERSIONS = 200;
export const MAX_SIGNATURE_BYTES = 8 * 1024;
export const SUPPORTED_CHANNELS = ['zap'] as const satisfies readonly Channel[];
export const ZAP_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-zap\.\d{8}\.[0-9a-f]{12}$/u;

export const TRUSTED_KEYS: ReadonlyMap<string, TrustedKey> = new Map([
    [
        'zolt-release-2026',
        {
            algorithm: 'Ed25519',
            keyId: 'zolt-release-2026',
            x509PublicKeyBase64: 'MCowBQYDK2VwAyEAn6cIrOCATTABSbWHl34vlZlP6xu/sFN8rxKga+/M/ZU=',
        },
    ],
]);
