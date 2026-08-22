import { describe, expect, it } from 'vitest';

import { ITranslationResource } from '../models/translation-resource.model.js';
import { mergeTranslationObjects, mergeTranslationResources } from './translation-resource.util.js';

function resource(
	position: number,
	content: Record<string, unknown>,
	locale = 'en'
): ITranslationResource {
	return {
		locale,
		sourceType: 'filesystem',
		sourceId: `source-${position}`,
		sourceIndex: position,
		resourceIndex: 0,
		position,
		content,
		origin: { type: 'file', path: `/project/${locale}-${position}.json` },
		writable: true
	};
}

describe('translation resource merging', () => {
	it('recursively overrides nested values without deleting siblings', () => {
		expect(mergeTranslationObjects(
			{ user: { name: 'Name', email: 'Email' } },
			{ user: { name: 'Display name' } }
		)).toEqual({ user: { name: 'Display name', email: 'Email' } });
	});

	it('replaces arrays, primitives, null, and conflicting types', () => {
		expect(mergeTranslationObjects(
			{ array: ['old'], primitive: 'old', nullable: 'old', conflict: { nested: true } },
			{ array: ['new'], primitive: 2, nullable: null, conflict: 'new' }
		)).toEqual({ array: ['new'], primitive: 2, nullable: null, conflict: 'new' });
	});

	it('uses stable resource positions rather than caller order', () => {
		const merged = mergeTranslationResources([
			resource(2, { title: 'third' }),
			resource(0, { title: 'first', retained: true }),
			resource(1, { title: 'second' }),
			resource(0, { title: 'Deutsch' }, 'de')
		]);

		expect(merged.get('en')).toEqual({ title: 'third', retained: true });
		expect(merged.get('de')).toEqual({ title: 'Deutsch' });
	});
});
