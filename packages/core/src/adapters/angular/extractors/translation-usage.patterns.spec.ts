import { describe, expect, it } from 'vitest';

import { DYNAMIC_PATTERNS, STATIC_HTML_PATTERNS, STATIC_TS_PATTERNS } from './translation-usage.patterns.js';

const ALL_PATTERN_DESCRIPTORS = [...STATIC_HTML_PATTERNS, ...STATIC_TS_PATTERNS, ...DYNAMIC_PATTERNS];

describe('translation usage pattern documentation', () => {
	it.each(ALL_PATTERN_DESCRIPTORS)('$matchType has a description and matching examples', (descriptor) => {
		expect(descriptor.description.trim()).not.toBe('');
		expect(descriptor.examples.length).toBeGreaterThan(0);

		for (const example of descriptor.examples) {
			// Clone stateful expressions so each documented example starts with lastIndex zero.
			const regex = new RegExp(descriptor.regex.source, descriptor.regex.flags);
			expect(regex.test(example)).toBe(true);
		}
	});
});
