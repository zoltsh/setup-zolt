import { describe, expect, it } from 'vitest';

import { array, exactKeys, integer, object, parseJson, string } from '../src/json';

describe('strict JSON primitives', () => {
    it('returns validated values', () => {
        const value = object(parseJson(Buffer.from('{"name":"zolt","count":1,"items":[]}'), 'fixture'), 'fixture');
        exactKeys(value, ['name', 'count', 'items'], [], 'fixture');
        expect(string(value, 'name', 'fixture')).toBe('zolt');
        expect(integer(value, 'count', 'fixture')).toBe(1);
        expect(array(value, 'items', 'fixture')).toEqual([]);
    });

    it.each([null, [], 'string', 1])('rejects non-object value %j', (value) => {
        expect(() => object(value, 'fixture')).toThrow(/JSON object/u);
    });

    it('rejects missing, unknown, and wrongly typed fields', () => {
        expect(() => {
            exactKeys({}, ['required'], [], 'fixture');
        }).toThrow(/missing/u);
        expect(() => {
            exactKeys({ extra: true }, [], [], 'fixture');
        }).toThrow(/unsupported/u);
        expect(() => string({ value: 1 }, 'value', 'fixture')).toThrow(/non-empty string/u);
        expect(() => integer({ value: 1.5 }, 'value', 'fixture')).toThrow(/integer/u);
        expect(() => array({ value: {} }, 'value', 'fixture')).toThrow(/array/u);
    });

    it('requires own fields and valid UTF-8', () => {
        const inherited = Object.create({ required: true }) as Record<string, unknown>;
        expect(() => {
            exactKeys(inherited, ['required'], [], 'fixture');
        }).toThrow(/missing/u);
        expect(() => parseJson(Buffer.from([0xc3, 0x28]), 'fixture')).toThrow(/valid UTF-8/u);
    });
});
