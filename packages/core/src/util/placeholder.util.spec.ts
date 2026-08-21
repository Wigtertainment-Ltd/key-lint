import { describe, expect, it } from 'vitest';

import { extractMustachePlaceholders, parsePlaceholderParameters } from './placeholder.util.js';

describe('placeholder utilities', () => {
	it('extracts, normalizes, deduplicates and sorts Mustache placeholders', () => {
		expect(extractMustachePlaceholders('Hello {{ name }}, {{count}} / {{ name }}')).toEqual(['count', 'name']);
	});

	it('ignores malformed and whitespace-containing Mustache expressions', () => {
		expect(extractMustachePlaceholders('Hello {name} {{ }} {{user name}}')).toEqual([]);
	});

	it('parses static shorthand, quoted, computed and nested object properties', () => {
		expect(parsePlaceholderParameters("{ name, 'count': total, ['title']: value, user: { firstName } }")).toEqual({
			kind: 'static',
			names: ['count', 'name', 'title', 'user', 'user.firstName'],
			dynamicPrefixes: ['count', 'title']
		});
	});

	it('marks variables, spreads and dynamic computed properties as dynamic', () => {
		expect(parsePlaceholderParameters('params')).toEqual({ kind: 'dynamic', names: [] });
		expect(parsePlaceholderParameters('{ name, ...params }')).toEqual({ kind: 'dynamic', names: ['name'] });
		expect(parsePlaceholderParameters('{ [field]: value }')).toEqual({ kind: 'dynamic', names: [] });
	});
});
