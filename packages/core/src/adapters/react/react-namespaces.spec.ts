import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DEFAULT_SCANNER_CONFIG } from '../../config/scanner-defaults.js';
import { NodeFileSystemAdapter } from '../../fs/node-file-system.adapter.js';
import { runScan } from '../../scan/run-scan.js';
import { ITranslationResource } from '../../models/translation-resource.model.js';
import { reactScanAdapter } from './react-scan.adapter.js';
import { extractReactUsages } from './react-usage.extractor.js';
import { detectReactDefaultNamespace } from './react-config.analyzer.js';

describe('React namespace resolution', () => {
	it.each([
		["'common'", "'save'", 'common:save'],
		["'translation'", "'save'", 'save'],
		["['admin', 'common']", "'save'", 'admin:save'],
		['undefined', "'save'", 'save'],
		['null', "'save'", 'save'],
		["'common'", "'admin:save'", 'admin:save'],
		["'common'", "'save', { ns: 'admin' }", 'admin:save'],
		["'common', { keyPrefix: 'section' }", "'title'", 'common:section.title'],
		["'common', { keyPrefix: 'section' }", "'title', { keyPrefix: 'buttons' }", 'common:buttons.title'],
		["'common', { keyPrefix: 'section' }", "'save', { keyPrefix: '' }", 'common:save'],
		["'common', { keyPrefix: 'section' }", "'admin:save', { keyPrefix: '' }", 'admin:save'],
		["'common', { keyPrefix: 'section' }", "'title', { ns: 'admin' }", 'admin:section.title'],
		["'translation', { keyPrefix: 'section' }", "'admin:save'", 'section.admin:save']
	])('resolves useTranslation(%s) with t(%s) to %s', (hookArguments, callArguments, expected) => {
		const source = `import { useTranslation } from 'react-i18next'; function App() { const { t } = useTranslation(${hookArguments}); return t(${callArguments}); }`;
		expect(extractReactUsages('App.tsx', source).map((usage) => usage.key)).toEqual([expected]);
	});

	it('uses the configured default namespace without treating it as another namespace alias', () => {
		const source = `import { useTranslation } from 'react-i18next';
function App() { const { t } = useTranslation(); return [t('save'), t('translation:save')]; }`;
		expect(extractReactUsages('App.tsx', source, 'common').map((usage) => usage.key)).toEqual(['common:save', 'save']);
	});

	it('resolves source-local constants for namespaces, option objects and prefixes', () => {
		const source = `import { useTranslation as useI18n } from 'react-i18next';
const NS = 'common'; const PREFIX = 'section'; const OPTIONS = { keyPrefix: PREFIX };
function App() { const { t: translate } = useI18n(NS, OPTIONS); const ns = 'admin'; return translate('title', { ns }); }`;
		expect(extractReactUsages('App.tsx', source).map((usage) => usage.key)).toEqual(['admin:section.title']);
	});

	it('keeps hook scopes separate across components and shadowed translators', () => {
		const source = `import { useTranslation } from 'react-i18next';
function A() { const { t } = useTranslation('common'); function nested(t) { return t('fake'); } return t('save'); }
function B() { const [t] = useTranslation('admin', { keyPrefix: 'buttons' }); return t('save'); }`;
		expect(extractReactUsages('App.tsx', source).map((usage) => usage.key)).toEqual(['common:save', 'admin:buttons.save']);
	});

	it.each([
		['runtimeNamespace', "'title'"],
		["'common', { keyPrefix: runtimePrefix }", "'title'"],
		["'common'", "'title', { ns: runtimeNamespace }"],
		["'common'", "'title', { ...runtimeOptions }"],
		["'common'", "'title', { ns: ['common', 'admin'] }"]
	])('rejects unresolved scope settings instead of guessing: %s / %s', (hookArguments, callArguments) => {
		const source = `import { useTranslation } from 'react-i18next'; function App() { const { t } = useTranslation(${hookArguments}); return t(${callArguments}); }`;
		expect(() => extractReactUsages('App.tsx', source)).toThrow(/statically|namespace/i);
	});

	it('keeps namespace files distinct in the translation matrix and reports the right locales', async () => {
		const projectRoot = fileURLToPath(new URL('../../../test/fixtures/react/react-i18next-json/namespaces', import.meta.url));
		const fs = new NodeFileSystemAdapter();
		const result = await runScan({ projectRoot, fs });
		expect(result.adapterId).toBe('react');
		expect(result.translationMatrix?.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: 'common:shared', values: { en: 'Common', de: 'Allgemein' } }),
				expect.objectContaining({ key: 'admin:shared', values: { en: 'Admin', de: 'Verwaltung' } }),
				expect.objectContaining({ key: 'admin:buttons.save', keyPresence: { en: true, de: false } })
			])
		);
		expect(result.findings.filter((finding) => finding.status === 'missing-in-language').map(({ key, language }) => ({ key, language }))).toEqual([
			{ key: 'admin:buttons.save', language: 'de' },
			{ key: 'common:missing', language: 'de' },
			{ key: 'common:missing', language: 'en' }
		]);
		const files = await reactScanAdapter.collectTranslationFiles({ projectRoot, config: DEFAULT_SCANNER_CONFIG }, fs);
		expect(await reactScanAdapter.extractDefinedKeys(files, fs)).toEqual(result.translationMatrix?.rows.map((row) => row.key));
	});

	it('merges overrides only inside the matching locale and namespace', async () => {
		const resource = (namespace: string, content: Record<string, unknown>, position: number): ITranslationResource => ({
			locale: 'en',
			content,
			position,
			sourceType: 'filesystem',
			sourceId: `filesystem-${position}`,
			sourceIndex: position,
			resourceIndex: 0,
			origin: { type: 'file', path: `/project/source-${position}/locales/en/${namespace}.json` },
			writable: true
		});
		const matrix = await reactScanAdapter.buildTranslationMatrixFromResources?.([
			resource('common', { title: 'Original', nested: { keep: 'Keep', replace: 'Old' } }, 0),
			resource('admin', { title: 'Admin' }, 1),
			resource('common', { title: 'Override', nested: 'New' }, 2)
		]);
		expect(matrix?.rows).toEqual([
			expect.objectContaining({ key: 'admin:title', values: { en: 'Admin' } }),
			expect.objectContaining({ key: 'common:nested', values: { en: 'New' } }),
			expect.objectContaining({ key: 'common:title', values: { en: 'Override' } })
		]);
	});

	it('applies the configured default namespace to both named and legacy locale files', async () => {
		const projectRoot = fileURLToPath(new URL('../../../test/fixtures/react/react-i18next-json/default-namespace', import.meta.url));
		const result = await runScan({ projectRoot, fs: new NodeFileSystemAdapter() });
		expect(result.translationMatrix?.rows).toEqual([
			expect.objectContaining({ key: 'common:title', values: { en: 'Title', de: 'Titel' } }),
			expect.objectContaining({ key: 'common:unused', values: { en: 'Unused', de: 'Unbenutzt' } })
		]);
	});
});

describe('React default namespace configuration', () => {
	it.each([
		["import i18n from 'i18next'; i18n.init({ defaultNS: 'common' });", 'common'],
		["import i18n from 'i18next'; i18n.use(plugin).init({ defaultNS: 'common' });", 'common'],
		["import * as i18n from 'i18next'; i18n.init({ defaultNS: 'common' });", 'common'],
		["import { init as configure } from 'i18next'; configure({ defaultNS: 'common' });", 'common'],
		["import i18n from 'i18next'; const NS = 'common'; const options = { defaultNS: NS }; i18n.init(options);", 'common'],
		["import i18n from 'i18next'; i18n.init({ ns: ['common', 'admin'] });", 'common'],
		["import i18n from 'i18next'; i18n.init({ ns: ['common', 'translation'] });", 'translation'],
		["import i18n from 'i18next'; i18n.init({ ns: 'common' });", 'common'],
		["import i18n from 'i18next'; i18n.init({ lng: 'en' });", 'translation'],
		["import i18n from 'i18next'; i18n.init(() => {});", 'translation'],
		["const i18n = { init() {} }; i18n.init({ defaultNS: 'fake' });", 'translation'],
		["import i18n from 'other-library'; i18n.init({ defaultNS: 'fake' });", 'translation'],
		["import i18n from 'i18next'; function local(i18n) { i18n.init({ defaultNS: 'fake' }); }", 'translation']
	])('reads the static configuration: %s', (content, expected) => {
		expect(detectReactDefaultNamespace([{ filePath: 'i18n.ts', content }])).toBe(expected);
	});

	it('rejects conflicting default namespaces across initialization calls', () => {
		const sources = ['common', 'admin'].map((namespace) => ({ filePath: `${namespace}.ts`, content: `import i18n from 'i18next'; i18n.init({ defaultNS: '${namespace}' });` }));
		expect(() => detectReactDefaultNamespace(sources)).toThrow(/conflicting/i);
	});

	it('does not execute runtime default namespace expressions', () => {
		expect(() => detectReactDefaultNamespace([{ filePath: 'i18n.ts', content: "import i18n from 'i18next'; i18n.init({ defaultNS: loadNamespace() });" }])).toThrow(
			/statically/i
		);
	});
});
