export type Channel = 'zap';

export type ReleaseTarget =
    | 'linux-arm64'
    | 'linux-x64'
    | 'macos-arm64'
    | 'macos-x64';

export interface ActionInputs {
    readonly channel: Channel;
    readonly sha256: string | undefined;
    readonly version: string;
}

export interface ReleaseArtifact {
    readonly archive: string;
    readonly archiveUrl: string;
    readonly binaryName: 'zolt';
    readonly format: 'tar.gz';
    readonly sha256: string;
    readonly target: ReleaseTarget;
}

export interface ReleaseSelection {
    readonly artifact: ReleaseArtifact;
    readonly channel: Channel;
    readonly commit: string;
    readonly createdAt: string;
    readonly version: string;
}

export interface TrustedKey {
    readonly algorithm: string;
    readonly keyId: string;
    readonly x509PublicKeyBase64: string;
}

export interface DownloadResult {
    readonly bytes: number;
    readonly sha256: string;
}

export interface Transport {
    download(url: URL, destination: string, maximumBytes: number, label: string): Promise<DownloadResult>;
    read(url: URL, maximumBytes: number, label: string): Promise<Buffer>;
}
