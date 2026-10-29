import { describe, expect, it } from 'vitest';
import { DEFAULT_SCANNER_CONFIG } from '../../config/scanner-defaults.js';
import { ITranslationResource } from '../../models/translation-resource.model.js';
import { reactScanAdapter } from './react-scan.adapter.js';
import { extractReactUsages } from './react-usage.extractor.js';

function source(body: string): string {
	return `import { useTranslation, Trans } from 'react-i18next'; function App(count, state, key) { const { t } = useTranslation('common'); ${body} }`;
}

async function findings(body: string, translations: Record<string, Record<string, string>>): ReturnType<typeof reactScanAdapter.runRules> {
	const resources: ITranslationResource[] = Object.entries(translations).map(([locale, content], position) => ({
		locale,
		namespace: 'common',
		content,
		position,
		sourceType: 'filesystem',
		sourceId: 'filesystem-1',
		sourceIndex: 0,
		resourceIndex: position,
		origin: { type: 'file', path: `/project/locales/${locale}/common.json` },
		writable: true
	}));
	return resourceFindings(body, resources);
}

async function resourceFindings(body: string, resources: ITranslationResource[]): ReturnType<typeof reactScanAdapter.runRules> {
	const matrix = await reactScanAdapter.buildTranslationMatrixFromResources!(resources);
	return reactScanAdapter.runRules({
		definedKeys: matrix.rows.map((row) => row.key),
		usedKeys: extractReactUsages('/project/App.tsx', source(body)),
		translationMatrix: matrix,
		baseLocale: matrix.locales.includes('en') ? 'en' : matrix.locales[0],
		baseLocaleSelectionSource: 'configured',
		context: { projectRoot: '/project', config: DEFAULT_SCANNER_CONFIG }
	});
}

describe('React count metadata', () => {
	it.each([
		["t('items', { count: 0 })", 0],
		["t('items', { count: 2 })", 2],
		["t('items', { count: -1 })", -1],
		["t('items', { count })", 'dynamic']
	])('reads the count in %s', (call, count) => {
		expect(extractReactUsages('App.tsx', source(`return ${call};`))[0]?.plural).toMatchObject({ count });
	});

	it('resolves const counts and keeps string counts out of plural handling', () => {
		const usages = extractReactUsages('App.tsx', source("const amount = 3; return [t('items', { count: amount }), t('text', { count: '3' })];"));
		expect(usages[0].plural?.count).toBe(3);
		expect(usages[1].plural).toBeUndefined();
	});

	it.each([
		['count={2}', '', 2],
		['values={{ count: 2 }}', '', 2],
		['tOptions={{ count: 2 }}', '', 2],
		['count={1} values={{ count: 2 }}', '', 2],
		['', '{{ count: 2 }}', 2],
		['count={count}', '', 'dynamic']
	])('reads Trans counts from %s / %s', (props, children, count) => {
		const usages = extractReactUsages('App.tsx', source(`return <Trans t={t} i18nKey="items" ${props}>${children}</Trans>;`));
		expect(usages[0]?.plural).toMatchObject({ count });
	});
});

describe('React plural forms', () => {
	it('selects the correct form per locale for a constant count', async () => {
		const result = await findings("return t('items', { count: 2 });", {
			en: { items_one: 'One', items_other: '{{count}} items' },
			ru: { items_one: 'Один', items_few: '{{count}} штуки', items_many: 'Много', items_other: 'Другое' },
			ja: { items_other: '{{count}}個' }
		});
		expect(result.filter((item) => item.status === 'used').map((item) => item.key)).toEqual(['common:items_few', 'common:items_other']);
		expect(result.filter((item) => item.status === 'missing-in-language' || item.status === 'extra-in-language')).toEqual([]);
		expect(result.some((item) => item.key === 'common:items')).toBe(false);
	});

	it('uses all applicable forms for runtime counts without imposing another language’s categories', async () => {
		const result = await findings("return t('items', { count });", {
			en: { items_one: 'One', items_other: 'Many' },
			ru: { items_one: 'One', items_few: 'Few', items_many: 'Many', items_other: 'Other' },
			ja: { items_other: 'Other' }
		});
		expect(result.every((item) => item.status === 'used')).toBe(true);
		expect(result.map((item) => item.key)).toEqual(['common:items_few', 'common:items_many', 'common:items_one', 'common:items_other']);
	});

	it('reports a required missing plural form in the affected locale', async () => {
		const result = await findings("return t('items', { count });", {
			en: { items_one: 'One', items_other: 'Many' },
			ru: { items_one: 'One', items_many: 'Many', items_other: 'Other' }
		});
		expect(result.filter((item) => item.status === 'missing-in-language')).toEqual([expect.objectContaining({ key: 'common:items_few', language: 'ru' })]);
	});

	it('uses an optional zero override without requiring it in other locales', async () => {
		const result = await findings("return t('items', { count: 0 });", {
			en: { items_zero: 'None', items_one: 'One', items_other: 'Many' },
			de: { items_one: 'Eins', items_other: 'Viele' }
		});
		expect(result.filter((item) => item.status === 'used').map((item) => item.key)).toEqual(['common:items_other', 'common:items_zero']);
		expect(result.some((item) => item.status === 'missing-in-language' || item.status === 'extra-in-language')).toBe(false);
	});

	it('requires all six Arabic categories for a runtime count', async () => {
		const result = await findings("return t('items', { count });", { ar: { items_one: 'One', items_other: 'Other' } });
		expect(result.filter((item) => item.status === 'missing-in-language').map((item) => item.key)).toEqual([
			'common:items_few',
			'common:items_many',
			'common:items_two',
			'common:items_zero'
		]);
	});

	it('accepts the unsuffixed fallback when the plural variant is absent', async () => {
		const result = await findings("return t('items', { count: 2 });", { en: { items: 'Items' } });
		expect(result).toEqual([expect.objectContaining({ key: 'common:items', status: 'used' })]);
	});

	it('handles ordinal forms and the cardinal fallback for a constant count', async () => {
		const result = await findings("return t('place', { count: 2, ordinal: true });", {
			en: { place_ordinal_two: '2nd', place_ordinal_other: 'Other' },
			de: { place_other: '2.' }
		});
		expect(result.filter((item) => item.status === 'used').map((item) => item.key)).toEqual(['common:place_ordinal_two', 'common:place_other']);
		expect(result.some((item) => item.status === 'missing-in-language' || item.status === 'extra-in-language')).toBe(false);
	});

	it('uses all ordinal categories for a runtime count', async () => {
		const result = await findings("return t('place', { count, ordinal: true });", {
			en: { place_ordinal_one: '1st', place_ordinal_two: '2nd', place_ordinal_few: '3rd', place_ordinal_other: 'Other' }
		});
		expect(result).toHaveLength(4);
		expect(result.every((item) => item.status === 'used')).toBe(true);
	});

	it('keeps a count-free lookup subject to locale coverage even when the same family is pluralized', async () => {
		const result = await findings("return [t('items', { count: 2 }), t('items')];", {
			en: { items: 'Items', items_other: 'Many' },
			ru: { items_few: 'Few' }
		});
		expect(result.filter((item) => item.status === 'missing-in-language')).toEqual([expect.objectContaining({ key: 'common:items', language: 'ru' })]);
	});

	it('uses the i18next developer fallback locale’s English plural rules', async () => {
		const result = await findings("return t('items', { count });", { dev: { items_one: 'One', items_other: 'Other' } });
		expect(result).toHaveLength(2);
		expect(result.every((item) => item.status === 'used')).toBe(true);
	});

	it('keeps ordinary literal suffixes and count-free lookups literal', async () => {
		const result = await findings("return t('items_one');", { en: { items_one: 'One', items_other: 'Other' } });
		expect(result).toEqual([expect.objectContaining({ key: 'common:items_one', status: 'used' }), expect.objectContaining({ key: 'common:items_other', status: 'unused' })]);
	});

	it('validates placeholders in plural forms that are absent from the base locale', async () => {
		const result = await findings("return t('items', { count: 2 });", { en: { items_other: '{{count}} items' }, ru: { items_few: '{{count}} {{name}}' } });
		expect(result).toContainEqual(
			expect.objectContaining({ key: 'common:items_few', status: 'placeholder-missing', language: 'ru', placeholderDetails: expect.objectContaining({ missing: ['name'] }) })
		);
	});

	it('does not silently apply English rules to an unsupported locale', async () => {
		const result = await findings("return t('items', { count: 2 });", { zz: { items_one: 'One', items_other: 'Other' } });
		expect(result.some((item) => item.status === 'dynamic-uncertain')).toBe(true);
		expect(result.some((item) => item.status === 'missing-in-language')).toBe(false);
	});
});

describe('React dynamic keys', () => {
	it('resolves source-local constant keys without reporting uncertainty', () => {
		const usages = extractReactUsages('App.tsx', source("const KEY = 'title'; return t(KEY);"));
		expect(usages).toHaveLength(1);
		expect(usages[0]).toMatchObject({ key: 'common:title' });
		expect(usages[0].isDynamic).not.toBe(true);
	});

	it.each(['t(`status.${state}.label`)', "t('status.' + state + '.label')", '<Trans t={t} i18nKey={`status.${state}.label`} />'])(
		'protects only matching definitions for %s',
		async (expression) => {
			const result = await findings(`return ${expression};`, {
				en: { 'status.ok.label': 'OK', 'status.error.label': 'Error', 'status.ok.other': 'Other', unrelated: 'Other' }
			});
			expect(result.filter((item) => item.status === 'dynamic-uncertain').map((item) => item.key)).toEqual(['common:status.error.label', 'common:status.ok.label']);
			expect(result.filter((item) => item.status === 'unused').map((item) => item.key)).toEqual(['common:status.ok.other', 'common:unrelated']);
			expect(result.some((item) => item.status === 'missing-in-language')).toBe(false);
		}
	);

	it('keeps a hook prefix and escapes literal dots when matching definitions', async () => {
		const result = await findings("const { t: nested } = useTranslation('common', { keyPrefix: 'section' }); return nested('status.' + state);", {
			en: { 'section.status.ok': 'OK', 'section.statusXok': 'Wrong', 'status.ok': 'Outside prefix' }
		});
		expect(result.filter((item) => item.status === 'dynamic-uncertain').map((item) => item.key)).toEqual(['common:section.status.ok']);
	});

	it('treats literal stars as key text rather than regular-expression operators', async () => {
		const result = await findings("return t('status.*.' + state);", { en: { 'status.*.ok': 'OK', 'status..ok': 'Other' } });
		expect(result.filter((item) => item.status === 'dynamic-uncertain').map((item) => item.key)).toEqual(['common:status.*.ok']);
	});

	it('preserves finite conditional alternatives without protecting unrelated definitions', async () => {
		const result = await findings("return t(state ? 'yes' : 'no');", { en: { yes: 'Yes', no: 'No', other: 'Other' } });
		expect(result.filter((item) => item.status === 'dynamic-uncertain').map((item) => item.key)).toEqual(['common:no', 'common:yes']);
		expect(result).toContainEqual(expect.objectContaining({ key: 'common:other', status: 'unused' }));
	});

	it('keeps an unresolved call visible even if no existing definition matches it', async () => {
		const result = await findings("return t('unknown.' + state);", { en: { unrelated: 'Other' } });
		expect(result.filter((item) => item.status === 'dynamic-uncertain')).toHaveLength(1);
		expect(result.some((item) => item.status === 'missing-in-language')).toBe(false);
	});

	it('does not turn a possibly plural dynamic key into a missing base key', async () => {
		const result = await findings("return t('cart.' + state, { count });", { en: { 'cart.items_one': 'One', 'cart.items_other': 'Other', unrelated: 'Other' } });
		expect(result.filter((item) => item.status === 'dynamic-uncertain').map((item) => item.key)).toEqual(['common:cart.items_one', 'common:cart.items_other']);
		expect(result.some((item) => item.status === 'missing-in-language')).toBe(false);
	});

	it('matches dynamic plural families with a fixed suffix before the plural ending', async () => {
		const result = await findings("return t('cart.' + state + '.label', { count });", {
			en: { 'cart.items.label_one': 'One', 'cart.items.label_other': 'Other', unrelated: 'Other' }
		});
		expect(result.filter((item) => item.status === 'dynamic-uncertain').map((item) => item.key)).toEqual(['common:cart.items.label_one', 'common:cart.items.label_other']);
		expect(result.some((item) => item.status === 'missing-in-language')).toBe(false);
	});

	it('respects an explicit namespace prefix and conservatively retains namespace overrides in wholly unknown keys', async () => {
		const resources: ITranslationResource[] = ['common', 'admin'].map((namespace, position) => ({
			locale: 'en',
			namespace,
			content: { 'status.ok': 'OK' },
			position,
			sourceType: 'filesystem',
			sourceId: 'filesystem-1',
			sourceIndex: 0,
			resourceIndex: position,
			origin: { type: 'file', path: `/project/locales/en/${namespace}.json` },
			writable: true
		}));
		const explicit = await resourceFindings("return t('common:status.' + state);", resources);
		expect(explicit.filter((item) => item.status === 'dynamic-uncertain').map((item) => item.key)).toEqual(['common:status.ok']);
		const unknown = await resourceFindings('return t(key);', resources);
		expect(unknown).toHaveLength(2);
		expect(unknown.every((item) => item.status === 'dynamic-uncertain')).toBe(true);
	});
});
