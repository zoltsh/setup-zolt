import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { SetupZoltError } from './errors';

const run = promisify(execFile);

export async function verifyZoltVersion(binary: string, expectedVersion: string): Promise<void> {
    try {
        const result = await run(binary, ['--version'], {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
            killSignal: 'SIGKILL',
            timeout: 10_000,
            windowsHide: true,
        });
        if (result.stdout !== expectedVersion && result.stdout !== `${expectedVersion}\n`) {
            throw new SetupZoltError(
                `Installed Zolt failed its version check. Expected only \`${expectedVersion}\` on stdout.`,
            );
        }
    } catch (error) {
        if (error instanceof SetupZoltError) throw error;
        throw new SetupZoltError('Could not execute downloaded Zolt binary.', { cause: error });
    }
}
