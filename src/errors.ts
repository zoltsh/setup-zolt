export class SetupZoltError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'SetupZoltError';
    }
}

export function errorMessage(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    const messages: string[] = [];
    const seen: Set<Error> = new Set();
    let current: unknown = error;
    while (current instanceof Error && messages.length < 4 && !seen.has(current)) {
        seen.add(current);
        const message = current.message || current.name;
        const parent = messages.at(-1);
        if (parent === undefined || parent !== message && !parent.endsWith(message)) messages.push(message);
        current = current.cause;
    }
    return messages.join(': ');
}
