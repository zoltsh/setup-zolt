import { SetupZoltError } from './errors';

export type JsonObject = Record<string, unknown>;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

export function decodeUtf8(payload: Buffer, label: string): string {
    try {
        return UTF8.decode(payload);
    } catch (error) {
        throw new SetupZoltError(`${label} is not valid UTF-8.`, { cause: error });
    }
}

export function parseJson(payload: Buffer, label: string): unknown {
    try {
        return JSON.parse(decodeUtf8(payload, label)) as unknown;
    } catch (error) {
        if (error instanceof SetupZoltError) throw error;
        throw new SetupZoltError(`${label} is not valid JSON.`, { cause: error });
    }
}

export function object(value: unknown, label: string): JsonObject {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new SetupZoltError(`${label} must be a JSON object.`);
    }
    return value as JsonObject;
}

export function exactKeys(value: JsonObject, required: readonly string[], optional: readonly string[], label: string): void {
    for (const key of required) {
        if (!Object.hasOwn(value, key)) throw new SetupZoltError(`${label} is missing \`${key}\`.`);
    }
    const allowed = new Set([...required, ...optional]);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new SetupZoltError(`${label} contains unsupported field \`${key}\`.`);
    }
}

export function string(value: JsonObject, key: string, label: string): string {
    const result = value[key];
    if (typeof result !== 'string' || result.length === 0) {
        throw new SetupZoltError(`${label} field \`${key}\` must be a non-empty string.`);
    }
    return result;
}

export function integer(value: JsonObject, key: string, label: string): number {
    const result = value[key];
    if (!Number.isSafeInteger(result)) {
        throw new SetupZoltError(`${label} field \`${key}\` must be an integer.`);
    }
    return result as number;
}

export function array(value: JsonObject, key: string, label: string): readonly unknown[] {
    const result = value[key];
    if (!Array.isArray(result)) {
        throw new SetupZoltError(`${label} field \`${key}\` must be an array.`);
    }
    return result;
}
