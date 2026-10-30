import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCANNER_CONFIG } from '../../config/scanner-defaults.js';
import { NodeFileSystemAdapter } from '../../fs/node-file-system.adapter.js';
import { ITranslationMatrix } from '../../models/scan-result.model.js';
import { runScan } from '../../scan/run-scan.js';
import { IKeyUsage } from '../scan-adapter.interface.js';
import { reactScanAdapter } from './react-scan.adapter.js';
import { extractReactUsages } from './react-usage.extractor.js';

describe('React interpolation parameters', () => {
	it.each([
		["t('greeting')", { kind: 'absent', names: [] }],
		["t('greeting', { name })", { kind: 'static', names: ['name'], dynamicPrefixes: ['name'] }],
		["t('greeting', { user: { name: 'Ada' } })", { kind: 'static', names: ['user', 'user.name'] }],
		["t('greeting', { user })", { kind: 'static', names: ['user'], dynamicPrefixes: ['user'] }],
		["t('greeting', { replace: { name: 'Ada' } })", { kind: 'static', names: ['name'] }],
		["t('greeting', { replace: 'text', name: 'Ada' })", { kind: 'static', names: ['name', 'replace'] }],
		["t('greeting', { ['name']: 'Ada' })", { kind: 'static', names: ['name'] }],
		["t('greeting', { replace: runtimeValues })", { kind: 'dynamic', names: [] }],
		["t('greeting', 'Fallback', { name: 'Ada' })", { kind: 'static', names: ['name'] }]
	])('extracts parameters from %s', (call, expected) => {
		const source = `import { useTranslation } from 'react-i18next'; function App() { const { t } = useTranslation(); return ${call}; }`;
		expect(extractReactUsages('App.tsx', source)[0]?.placeholderParameters).toEqual(expected);
	});

	it('resolves const interpolation objects and nested const values', () => {
		const source = `import { useTranslation } from 'react-i18next'; const user = { name: 'Ada' }; const options = { user };
function App() { const { t } = useTranslation(); return t('greeting', options); }`;
		expect(extractReactUsages('App.tsx', source)[0]?.placeholderParameters).toMatchObject({ kind: 'static', names: ['user', 'user.name'] });
	});
});

describe('React Trans components', () => {
	it.each([
		['Trans', "import { Trans } from 'react-i18next';"],
		['Translate', "import { Trans as Translate } from 'react-i18next';"],
		['I18n.Trans', "import * as I18n from 'react-i18next';"]
	])('extracts the imported %s component with source evidence', (tag, imports) => {
		const source = `${imports}\nconst element = <${tag} i18nKey="greeting" values={{ name: 'Ada' }} />;`;
		const usages = extractReactUsages('App.tsx', source);
		expect(usages).toHaveLength(1);
		expect(usages[0]).toMatchObject({ key: 'greeting', filePath: 'App.tsx', line: 2, column: 17, matchType: 'react-trans' });
		expect(usages[0].placeholderParameters).toMatchObject({ kind: 'static', names: ['name'] });
		expect(usages[0].snippet).toContain('i18nKey="greeting"');
	});

	it('combines values, tOptions, count and interpolation objects in nested JSX children', () => {
		const source = `import { Trans } from 'react-i18next'; const element = <Trans i18nKey="greeting" values={{ title: 'Dr' }} tOptions={{ extra: 'Extra' }} count={3}>
Hello <strong>{{ name: 'Ada' }}</strong> {{ user: { firstName: 'Ada' } }}</Trans>;`;
		expect(extractReactUsages('App.tsx', source)[0]?.placeholderParameters).toMatchObject({
			kind: 'static',
			names: ['count', 'extra', 'name', 'title', 'user', 'user.firstName']
		});
	});

	it('uses a bound t namespace and prefix, with explicit overrides from ns and tOptions', () => {
		const source = `import { Trans, useTranslation } from 'react-i18next'; function App() { const { t } = useTranslation('common', { keyPrefix: 'section' });
return <><Trans t={t} i18nKey="title" /><Trans t={t} ns="admin" i18nKey="save" tOptions={{ keyPrefix: '' }} /></>; }`;
		expect(extractReactUsages('App.tsx', source).map((usage) => usage.key)).toEqual(['common:section.title', 'admin:save']);
	});

	it('uses the project default namespace and resolves constant key expressions', () => {
		const source = `import { Trans } from 'react-i18next'; const KEY = 'title'; const element = <Trans i18nKey={KEY} />;`;
		expect(extractReactUsages('App.tsx', source, 'common').map((usage) => usage.key)).toEqual(['common:title']);
	});

	it('keeps the Trans namespace prop ahead of tOptions.ns', () => {
		const source = `import { Trans } from 'react-i18next'; const element = <Trans ns="common" i18nKey="title" tOptions={{ ns: 'wrong' }} />;`;
		expect(extractReactUsages('App.tsx', source)[0]?.key).toBe('common:title');
	});

	it('marks unresolved values as uncertain while retaining known child parameters', () => {
		const source = `import { Trans } from 'react-i18next'; const element = <Trans i18nKey="greeting" values={runtimeValues}>{{ name: 'Ada' }}</Trans>;`;
		expect(extractReactUsages('App.tsx', source)[0]?.placeholderParameters).toMatchObject({ kind: 'dynamic', names: ['name'] });
	});

	it('does not take interpolation values from element attributes or nested Trans values props', () => {
		const source = `import { Trans } from 'react-i18next'; const element = <Trans i18nKey="outer"><span data-user={{ name: 'Ada' }} /><Trans i18nKey="inner" values={{ name: 'Ada' }} /></Trans>;`;
		const usages = extractReactUsages('App.tsx', source);
		expect(usages).toHaveLength(2);
		expect(usages[0].placeholderParameters?.names).not.toContain('name');
		expect(usages[1].placeholderParameters?.names).toContain('name');
	});

	it('replaces child object paths when values supplies a different object under the same name', () => {
		const source = `import { Trans } from 'react-i18next'; const element = <Trans i18nKey="greeting" values={{ user: { id: '1' } }}>{{ user: { name: 'Ada' } }}</Trans>;`;
		expect(extractReactUsages('App.tsx', source)[0]?.placeholderParameters).toMatchObject({ kind: 'static', names: ['user', 'user.id'] });
	});

	it('marks nested child paths uncertain when unresolved values can replace their parent object', () => {
		const source = `import { Trans } from 'react-i18next'; const element = <Trans i18nKey="greeting" values={runtimeValues}>{{ user: { name: 'Ada' } }}</Trans>;`;
		const parameters = extractReactUsages('App.tsx', source)[0]?.placeholderParameters;
		expect(parameters).toMatchObject({ kind: 'dynamic', names: ['user'], dynamicPrefixes: ['user'] });
	});

	it.each([
		"function Trans() {} const element = <Trans i18nKey='fake' />;",
		"import { Trans } from 'another-library'; const element = <Trans i18nKey='fake' />;",
		"import type { Trans } from 'react-i18next'; const element = <Trans i18nKey='fake' />;",
		"import { Trans } from 'react-i18next'; function App(Trans) { return <Trans i18nKey='fake' />; }"
	])('ignores unrelated or shadowed components: %s', (source) => {
		expect(extractReactUsages('App.tsx', source)).toEqual([]);
	});

	it('does not invent keys from defaults and retains dynamic i18nKey expressions as uncertain', () => {
		const source = `import { Trans } from 'react-i18next'; const element = <><Trans defaults="Hello">Hello</Trans><Trans i18nKey={runtimeKey} /></>;`;
		expect(extractReactUsages('App.tsx', source)).toEqual([expect.objectContaining({ key: 'runtimeKey', isDynamic: true })]);
	});

	it('retains nested t calls as separate usages without duplicating paired Trans elements', () => {
		const source = `import { Trans, useTranslation } from 'react-i18next'; function App() { const { t } = useTranslation(); return <Trans i18nKey="outer"><a title={t('title')}>Link</a></Trans>; }`;
		expect(extractReactUsages('App.tsx', source).map((usage) => usage.key)).toEqual(['outer', 'title']);
	});
});

const context = { projectRoot: '/project', config: DEFAULT_SCANNER_CONFIG };
const matrix: ITranslationMatrix = {
	locales: ['de', 'en'],
	totalKeys: 1,
	rows: [{ key: 'greeting', values: { en: 'Hello {{name}}', de: 'Hallo {{name}}' }, keyPresence: { en: true, de: true }, placeholders: { en: ['name'], de: ['name'] } }]
};

function runRules(usages: IKeyUsage[], translationMatrix = matrix): ReturnType<typeof reactScanAdapter.runRules> {
	return reactScanAdapter.runRules({ definedKeys: ['greeting'], usedKeys: usages, translationMatrix, baseLocale: 'en', baseLocaleSelectionSource: 'exact-en', context });
}

describe('React placeholder findings', () => {
	it('reports missing parameters per usage with source evidence and required names', async () => {
		const findings = await runRules([{ key: 'greeting', filePath: '/project/App.tsx', line: 4, column: 3 }]);
		expect(findings).toContainEqual(
			expect.objectContaining({
				key: 'greeting',
				status: 'placeholder-missing',
				severity: 'error',
				placeholderDetails: { required: ['name'], provided: [], missing: ['name'] },
				evidence: [expect.objectContaining({ line: 4, column: 3 })]
			})
		);
	});

	it('warns for unresolved parameters while accepting known required names and extra values', async () => {
		const findings = await runRules([
			{ key: 'greeting', filePath: '/project/a.tsx', placeholderParameters: { kind: 'dynamic', names: [] } },
			{ key: 'greeting', filePath: '/project/b.tsx', placeholderParameters: { kind: 'static', names: ['name', 'extra'] } }
		]);
		expect(findings.filter((finding) => finding.status === 'placeholder-uncertain')).toHaveLength(1);
		expect(findings.filter((finding) => finding.status === 'placeholder-missing')).toHaveLength(0);
	});

	it('separates definitely missing names from uncertain nested paths', async () => {
		const nestedMatrix: ITranslationMatrix = {
			locales: ['en'],
			totalKeys: 1,
			rows: [{ key: 'greeting', values: { en: '{{user.name}} {{other}}' }, keyPresence: { en: true }, placeholders: { en: ['other', 'user.name'] } }]
		};
		const findings = await runRules(
			[{ key: 'greeting', filePath: '/project/a.tsx', placeholderParameters: { kind: 'static', names: ['user'], dynamicPrefixes: ['user'] } }],
			nestedMatrix
		);
		expect(findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: 'placeholder-missing', placeholderDetails: expect.objectContaining({ missing: ['other'] }) }),
				expect.objectContaining({ status: 'placeholder-uncertain', placeholderDetails: expect.objectContaining({ missing: ['user.name'] }) })
			])
		);
	});

	it('reports locale placeholder mismatches while ignoring missing translations', async () => {
		const mismatch: ITranslationMatrix = {
			...matrix,
			rows: [
				{ ...matrix.rows[0], placeholders: { en: ['name'], de: ['person'] } },
				{ key: 'missing', values: { en: '{{name}}', de: '' }, keyPresence: { en: true, de: false }, placeholders: { en: ['name'], de: [] } }
			]
		};
		const findings = await runRules([], mismatch);
		expect(findings.filter((finding) => finding.status === 'placeholder-mismatch')).toEqual([
			expect.objectContaining({ key: 'greeting', language: 'de', placeholderDetails: { required: ['name'], expected: ['name'], actual: ['person'] } })
		]);
	});

	it('matches the fixture contracts, including formatted and unescaped placeholders', async () => {
		const projectRoot = fileURLToPath(new URL('../../../test/fixtures/react/react-i18next-json/trans-placeholders', import.meta.url));
		const result = await runScan({ projectRoot, fs: new NodeFileSystemAdapter() });
		expect(result.translationMatrix?.rows.find((row) => row.key === 'common:formatted')?.placeholders).toEqual({ en: ['html', 'price'], de: ['html', 'price'] });
		expect(result.findings.filter((finding) => finding.key === 'common:formatted').map((finding) => finding.status)).toEqual(['used']);
		expect(result.findings.filter((finding) => finding.key === 'common:child').map((finding) => finding.status)).toEqual(['used']);
	});
});
