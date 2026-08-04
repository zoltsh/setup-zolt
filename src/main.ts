import { dirname } from 'node:path';

import * as core from '@actions/core';

import { LATEST_VERSION_SELECTOR } from './constants';
import { errorMessage } from './errors';
import { ActionsHttpTransport } from './http';
import { type InputReader, readInputs } from './inputs';
import { installZolt } from './install';
import { resolveTarget } from './platform';
import type { Transport } from './types';

export interface ActionCore extends InputReader {
    addPath(path: string): void;
    info(message: string): void;
    setFailed(message: string | Error): void;
    setOutput(name: string, value: unknown): void;
}

export interface DisposableTransport extends Transport {
    dispose(): void;
}

export interface ActionDependencies {
    readonly architecture?: string;
    readonly core?: ActionCore;
    readonly install?: typeof installZolt;
    readonly platform?: NodeJS.Platform;
    readonly transport?: DisposableTransport;
}

export async function runAction(dependencies: ActionDependencies = {}): Promise<void> {
    const actionCore = dependencies.core ?? core;
    const transport = dependencies.transport ?? new ActionsHttpTransport();
    try {
        const inputs = readInputs(actionCore);
        const target = resolveTarget(
            dependencies.platform ?? process.platform,
            dependencies.architecture ?? process.arch,
        );
        actionCore.info(inputs.version === LATEST_VERSION_SELECTOR
            ? `Resolving the latest Zolt for ${target} from signed channel ${inputs.channel}.`
            : `Resolving exact Zolt ${inputs.version} for ${target} from signed ${inputs.channel} release metadata.`);
        const result = await (dependencies.install ?? installZolt)(inputs, target, transport);
        actionCore.addPath(dirname(result.binary));
        actionCore.setOutput('version', result.version);
        actionCore.setOutput('target', result.target);
        actionCore.setOutput('path', result.binary);
        actionCore.setOutput('sha256', result.sha256);
        actionCore.info(
            `${result.cacheHit ? 'Using cached' : 'Installed'} Zolt ${result.version} for ${result.target}; SHA-256 ${result.sha256}.`,
        );
    } catch (error) {
        actionCore.setFailed(errorMessage(error));
    } finally {
        try {
            transport.dispose();
        } catch (error) {
            actionCore.setFailed(`Could not dispose HTTP resources: ${errorMessage(error)}`);
        }
    }
}
