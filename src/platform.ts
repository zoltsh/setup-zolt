import { SetupZoltError } from './errors';
import type { ReleaseTarget } from './types';

export function resolveTarget(platform: NodeJS.Platform, architecture: string): ReleaseTarget {
    if (platform === 'linux' && architecture === 'x64') return 'linux-x64';
    if (platform === 'linux' && architecture === 'arm64') return 'linux-arm64';
    if (platform === 'darwin' && architecture === 'x64') return 'macos-x64';
    if (platform === 'darwin' && architecture === 'arm64') return 'macos-arm64';
    if (platform === 'win32' && architecture === 'x64') {
        throw new SetupZoltError(
            'Windows runners are not supported yet because Zolt does not currently publish a verified windows-x64 archive.',
        );
    }
    throw new SetupZoltError(
        `Unsupported runner platform ${platform}/${architecture}. Supported targets: linux-x64, linux-arm64, macos-x64, macos-arm64.`,
    );
}
