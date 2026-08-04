import { chmod, lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, posix, resolve, sep } from 'node:path';

import { extract, list, type ReadEntry } from 'tar';

import {
    MAX_ARCHIVE_DECOMPRESSION_RATIO,
    MAX_ARCHIVE_ENTRIES,
    MAX_ARCHIVE_ENTRY_BYTES,
    MAX_EXTRACTED_BYTES,
} from './constants';
import { SetupZoltError } from './errors';

const ALLOWED_ENTRY_TYPES = new Set(['Directory', 'File', 'OldFile']);

export interface ArchiveEntryDescriptor {
    readonly mode?: number;
    readonly path: string;
    readonly size: number;
    readonly type: string;
}

interface InspectionState {
    readonly paths: Set<string>;
    entries: number;
    error?: SetupZoltError;
    foundBinary: boolean;
    uncompressedBytes: number;
}

export async function inspectTarGz(archive: string, expectedRoot: string): Promise<void> {
    const state: InspectionState = {
        entries: 0,
        foundBinary: false,
        paths: new Set(),
        uncompressedBytes: 0,
    };
    try {
        await list({
            file: archive,
            gzip: true,
            maxDecompressionRatio: MAX_ARCHIVE_DECOMPRESSION_RATIO,
            onentry: (entry) => {
                entry.resume();
                if (state.error !== undefined) return;
                try {
                    inspectEntry(entry, expectedRoot, state);
                } catch (error) {
                    state.error = error instanceof SetupZoltError
                        ? error
                        : new SetupZoltError('Could not validate a Zolt archive entry.', { cause: error });
                }
            },
            strict: true,
        });
    } catch (error) {
        if (error instanceof SetupZoltError) throw error;
        throw new SetupZoltError('Could not inspect the downloaded Zolt tar.gz archive.', { cause: error });
    }
    if (state.error !== undefined) throw state.error;
    if (state.entries === 0) throw new SetupZoltError('Downloaded Zolt archive is empty.');
    if (!state.foundBinary) {
        throw new SetupZoltError(`Downloaded Zolt archive is missing ${expectedRoot}/bin/zolt.`);
    }
}

export async function extractTarGz(archive: string, destination: string, expectedRoot: string): Promise<string> {
    await mkdir(destination, { recursive: true, mode: 0o700 });
    // Throwing inside tar's filter can leave its parser unfinished. Remember the
    // first problem, reject later entries, and report it after the stream ends.
    let validationError: SetupZoltError | undefined;
    try {
        await extract({
            cwd: destination,
            file: archive,
            filter: (_entryPath, entry) => {
                if (validationError !== undefined) return false;
                try {
                    validateArchiveEntry(entry as ReadEntry, expectedRoot);
                    return true;
                } catch (error) {
                    validationError = error instanceof SetupZoltError
                        ? error
                        : new SetupZoltError('Could not validate a Zolt archive entry.', { cause: error });
                    return false;
                }
            },
            gzip: true,
            maxDecompressionRatio: MAX_ARCHIVE_DECOMPRESSION_RATIO,
            maxDepth: 16,
            noMtime: true,
            preserveOwner: false,
            preservePaths: false,
            strict: true,
        });
    } catch (error) {
        if (error instanceof SetupZoltError) throw error;
        throw new SetupZoltError('Could not extract the verified Zolt tar.gz archive.', { cause: error });
    }
    if (validationError !== undefined) throw validationError;
    const destinationRoot = await realpath(destination);
    const extractedRoot = await realpath(resolve(destination, expectedRoot));
    assertContained(destinationRoot, extractedRoot, 'extracted Zolt root');
    const binary = resolve(extractedRoot, 'bin', 'zolt');
    const binaryStatus = await lstat(binary);
    if (!binaryStatus.isFile() || binaryStatus.isSymbolicLink()) {
        throw new SetupZoltError('Extracted Zolt binary is not a regular file.');
    }
    assertContained(extractedRoot, await realpath(binary), 'extracted Zolt binary');
    await chmod(binary, 0o755);
    return extractedRoot;
}

export function validateArchiveEntry(entry: ArchiveEntryDescriptor, expectedRoot: string): string {
    const canonicalPath = validateArchivePath(entry.path, expectedRoot);
    if (!ALLOWED_ENTRY_TYPES.has(entry.type)) {
        throw new SetupZoltError(
            `Zolt archive entry \`${canonicalPath}\` has forbidden type \`${entry.type}\`; links and special files are not allowed.`,
        );
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_ARCHIVE_ENTRY_BYTES) {
        throw new SetupZoltError(`Zolt archive entry \`${canonicalPath}\` has an invalid or excessive size.`);
    }
    if (entry.mode !== undefined && (entry.mode & 0o6000) !== 0) {
        throw new SetupZoltError(`Zolt archive entry \`${canonicalPath}\` must not set setuid or setgid bits.`);
    }
    return canonicalPath;
}

export function validateArchivePath(entryPath: string, expectedRoot: string): string {
    if (
        entryPath.length === 0
        || Buffer.byteLength(entryPath, 'utf8') > 512
        || entryPath.includes('\0')
        || entryPath.includes('\\')
    ) {
        throw new SetupZoltError(`Zolt archive contains unsafe entry path \`${entryPath}\`.`);
    }
    let value = entryPath.endsWith('/') ? entryPath.slice(0, -1) : entryPath;
    while (value.startsWith('./')) value = value.slice(2);
    if (
        value.length === 0
    || isAbsolute(value)
    || /^[A-Za-z]:/u.test(value)
    || value.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    || posix.normalize(value) !== value
    ) {
        throw new SetupZoltError(`Zolt archive contains unsafe entry path \`${entryPath}\`.`);
    }
    const [root] = value.split('/');
    if (root !== expectedRoot) {
        throw new SetupZoltError(
            `Zolt archive entry \`${entryPath}\` is outside expected top-level directory \`${expectedRoot}\`.`,
        );
    }
    return value;
}

function inspectEntry(entry: ReadEntry, expectedRoot: string, state: InspectionState): void {
    const path = validateArchiveEntry(entry, expectedRoot);
    const collisionKey = path.normalize('NFC').toLowerCase();
    if (state.paths.has(collisionKey)) {
        throw new SetupZoltError(`Zolt archive repeats or case-collides at entry \`${path}\`.`);
    }
    state.paths.add(collisionKey);
    state.entries += 1;
    state.uncompressedBytes += entry.size;
    if (state.entries > MAX_ARCHIVE_ENTRIES) {
        throw new SetupZoltError(`Zolt archive exceeds the ${MAX_ARCHIVE_ENTRIES.toString()}-entry limit.`);
    }
    if (state.uncompressedBytes > MAX_EXTRACTED_BYTES) {
        throw new SetupZoltError(
            `Zolt archive exceeds the ${MAX_EXTRACTED_BYTES.toString()}-byte extracted-size limit.`,
        );
    }
    if (path === `${expectedRoot}/bin/zolt` && (entry.type === 'File' || entry.type === 'OldFile')) {
        state.foundBinary = true;
    }
}

function assertContained(root: string, candidate: string, label: string): void {
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
        throw new SetupZoltError(`${label} escaped its owned directory.`);
    }
}
