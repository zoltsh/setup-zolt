import type * as core from '@actions/core';

import { LATEST_VERSION_SELECTOR, SUPPORTED_CHANNELS, ZAP_VERSION_PATTERN } from './constants';
import { SetupZoltError } from './errors';
import type { ActionInputs, Channel } from './types';

const SHA256 = /^[0-9a-f]{64}$/u;

export interface InputReader {
    getInput(name: string, options?: core.InputOptions): string;
}

export function readInputs(reader: InputReader): ActionInputs {
    const channel = requireChannel(reader.getInput('channel'));
    const version = requireVersion(reader.getInput('version', { required: true }));
    const checksumInput = reader.getInput('sha256');
    const sha256 = checksumInput.trim() === '' ? undefined : requireSha256(checksumInput);
    if (version !== LATEST_VERSION_SELECTOR && sha256 === undefined) {
        throw new SetupZoltError('Input `sha256` is required when `version` is an exact Zolt version.');
    }
    return { channel, sha256, version };
}

export function requireChannel(value: string): Channel {
    const channel = value.trim() || 'zap';
    if (!SUPPORTED_CHANNELS.includes(channel as (typeof SUPPORTED_CHANNELS)[number])) {
        throw new SetupZoltError(
            `Unsupported release channel \`${channel}\`. Supported channels: ${SUPPORTED_CHANNELS.join(', ')}.`,
        );
    }
    return channel as Channel;
}

export function requireSha256(value: string): string {
    const sha256 = value.trim().toLowerCase();
    if (!SHA256.test(sha256)) {
        throw new SetupZoltError('Input `sha256` must be exactly 64 hexadecimal characters.');
    }
    return sha256;
}

export function requireVersion(value: string): string {
    const version = value.trim();
    if (version === LATEST_VERSION_SELECTOR) return version;
    if (
        version.length > 128
    || version.includes('..')
    || version.includes('/')
    || version.includes('\\')
    || !ZAP_VERSION_PATTERN.test(version)
    ) {
        throw new SetupZoltError(
            'Input `version` must be `latest` or an exact zap version such as `0.1.0-zap.20260728.ec2351c87746`.',
        );
    }
    return version;
}
