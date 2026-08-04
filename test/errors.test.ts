import { describe, expect, it } from 'vitest';

import { SetupZoltError, errorMessage } from '../src/errors';

describe('action error messages', () => {
    it('renders a bounded, non-duplicated cause chain', () => {
        const root = new Error('socket closed');
        const wrapped = new SetupZoltError('Could not read release metadata.', { cause: root });
        expect(errorMessage(wrapped)).toBe('Could not read release metadata.: socket closed');
        expect(errorMessage(new SetupZoltError('Operation failed: socket closed', { cause: root })))
            .toBe('Operation failed: socket closed');
    });

    it('handles non-errors and cyclic causes', () => {
        expect(errorMessage('failure')).toBe('failure');
        const cyclic = new Error('cycle');
        cyclic.cause = cyclic;
        expect(errorMessage(cyclic)).toBe('cycle');
    });
});
