import { describe, expect, it } from 'vitest';

import { DEFAULT_SCANNER_CONFIG } from '../../config/scanner-defaults.js';
import { runScan } from '../../scan/run-scan.js';
import { matchesAny } from '../../util/glob.util.js';
import { normalizePath } from '../../util/path.util.js';
import { AdapterRegistry } from '../adapter-registry.js';
import { defaultAdapterRegistry } from '../default-adapter-registry.js';
import { IFileSystemAdapter, IProjectContext, IKeyUsage } from '../scan-adapter.interface.js';
import { reactScanAdapter } from './react-scan.adapter.js';
import type { IScannerConfig, IProjectScanResult, ITranslationMatrixRow, IFinding, IFileEvidence } from '../../index.js';
import type { IAdapterMatch } from '../adapter.interfaces.js';

const projectRoot: string = 'workspace/react-project';
const context: IProjectContext = { projectRoot, config: DEFAULT_SCANNER_CONFIG };
const packageJson: string = JSON.stringify({ dependencies: { react: '^19.0.0', 'react-i18next': '^17.0.13', i18next: '^26.0.0' } });

function createFs(files: Record<string, string>): IFileSystemAdapter {
	return {
		fileExists: async (path: string): Promise<boolean> => Promise.resolve(files[normalizePath(path)] !== undefined),
		readFile: async (path: string): Promise<string> => {
			const content: string = files[normalizePath(path)];
			if (content === undefined) {
				throw new Error(`File not found: ${path}`);
			}
			return Promise.resolve(content);
		},
		listFiles: async (root: string, includes: string[], excludes: string[]): Promise<string[]> =>
			Promise.resolve(
				Object.keys(files).filter((path: string): boolean => {
					const prefix: string = `${normalizePath(root)}/`;
					const relative: string = path.slice(prefix.length);
					return (
						path.startsWith(prefix) && (matchesAny(path, includes) || matchesAny(relative, includes)) && !matchesAny(path, excludes) && !matchesAny(relative, excludes)
					);
				})
			)
	};
}

describe('reactScanAdapter', (): void => {
	it('resolves a namespace-qualified write to the highest-precedence matching file', async (): Promise<void> => {
		const fs: IFileSystemAdapter = createFs({
			[`${projectRoot}/package.json`]: packageJson,
			[`${projectRoot}/base/en/common.json`]: '{}',
			[`${projectRoot}/overrides/en/common.json`]: '{}',
			[`${projectRoot}/base/en/admin.json`]: '{}'
		});
		const config: IScannerConfig = {
			...DEFAULT_SCANNER_CONFIG,
			translationSources: [
				{ type: 'filesystem' as const, includeGlobs: ['base/**/*.json'] },
				{ type: 'filesystem' as const, includeGlobs: ['overrides/**/*.json'] }
			]
		};
		expect(await reactScanAdapter.resolveTranslationWriteTarget!({ projectRoot, config }, fs, 'en', 'common:buttons.save')).toEqual({
			filePath: `${projectRoot}/overrides/en/common.json`,
			key: 'buttons.save'
		});
	});

	it('resolves legacy locale files using the statically configured default namespace', async (): Promise<void> => {
		const fs: IFileSystemAdapter = createFs({
			[`${projectRoot}/package.json`]: packageJson,
			[`${projectRoot}/src/i18n.ts`]: "import i18n from 'i18next'; i18n.init({ defaultNS: 'common' });",
			[`${projectRoot}/locales/en.json`]: '{}'
		});
		expect(await reactScanAdapter.resolveTranslationWriteTarget!(context, fs, 'en', 'common:title')).toEqual({ filePath: `${projectRoot}/locales/en.json`, key: 'title' });
	});
	it.each(['dependencies', 'devDependencies'])('detects react-i18next in %s', async (dependencyType: string): Promise<void> => {
		const fs: IFileSystemAdapter = createFs({ [`${projectRoot}/package.json`]: JSON.stringify({ [dependencyType]: { react: '^19', 'react-i18next': '^17' } }) });
		expect(await reactScanAdapter.detect(projectRoot, fs)).toMatchObject({ supported: true, confidence: 1, resolvedProjectRoot: projectRoot });
	});

	it('detects the closest supported project when a source directory is selected', async (): Promise<void> => {
		const fs: IFileSystemAdapter = createFs({ 'workspace/package.json': packageJson, [`${projectRoot}/package.json`]: packageJson });
		expect(await reactScanAdapter.detect(`${projectRoot}/src/components`, fs)).toMatchObject({ supported: true, resolvedProjectRoot: projectRoot });
	});

	it('prefers the selected React project over an enclosing Angular workspace', async (): Promise<void> => {
		const fs: IFileSystemAdapter = createFs({
			'workspace/angular.json': '{}',
			'workspace/package.json': '{"dependencies":{"@angular/core":"^22"}}',
			[`${projectRoot}/package.json`]: packageJson
		});
		const match: IAdapterMatch | null = await defaultAdapterRegistry.detectBestAdapter(projectRoot, fs);
		expect(match?.adapter.id).toBe('react');
		expect(match?.detection.resolvedProjectRoot).toBe(projectRoot);
	});

	it('prefers a selected Angular project over a higher-confidence React parent', async (): Promise<void> => {
		const fs: IFileSystemAdapter = createFs({
			'workspace/package.json': packageJson,
			[`${projectRoot}/project.json`]: '{"name":"angular-app"}',
			[`${projectRoot}/src/assets/i18n/en.json`]: '{"title":"Title"}',
			[`${projectRoot}/src/app.component.ts`]: "this.translate.instant('title');",
			'workspace/src/assets/i18n/en.json': '{"outside":"Outside"}'
		});
		const result: IProjectScanResult = await runScan({ projectRoot, fs });
		expect(result.adapterId).toBe('angular');
		expect(result.projectRoot).toBe(projectRoot);
		expect(result.translationMatrix?.rows.map((row: ITranslationMatrixRow): string => row.key)).toEqual(['title']);
		expect(result.findings.every((finding: IFinding): boolean => finding.evidence.every((entry: IFileEvidence): boolean => entry.filePath.startsWith(`${projectRoot}/`)))).toBe(
			true
		);
	});

	it.each(['{}', '{"dependencies":{"react":"^19"}}', '{"dependencies":{"react":"^19","i18next":"^26"}}', '{"dependencies":{"react-intl":"^10"}}', 'null', '{invalid json'])(
		'rejects missing or unrelated React translation dependencies: %s',
		async (manifest: string): Promise<void> => {
			expect(await reactScanAdapter.detect(projectRoot, createFs({ [`${projectRoot}/package.json`]: manifest }))).toMatchObject({ supported: false });
		}
	);

	it.each(['js', 'jsx', 'ts', 'tsx'])('extracts hook-bound static keys and locations from .%s files', async (extension: string): Promise<void> => {
		const filePath: string = `${projectRoot}/src/App.${extension}`;
		const source: string = "import { useTranslation } from 'react-i18next';\nexport function App() {\n\tconst { t } = useTranslation();\n\treturn t('app.title');\n}";
		const usages: IKeyUsage[] = await reactScanAdapter.extractUsedKeys(context, createFs({ [filePath]: source }));
		expect(usages).toHaveLength(1);
		expect(usages[0]).toMatchObject({ key: 'app.title', filePath, line: 4, column: 9, sourceIndex: source.indexOf("t('app.title')") });
		expect(usages[0].snippet).toContain("t('app.title')");
	});

	it('parses translation calls inside JSX attributes and children', async (): Promise<void> => {
		const source: string = "import { useTranslation } from 'react-i18next'; function App() { const { t } = useTranslation(); return <h1 title={t('title')}>{t('body')}</h1>; }";
		const usages: IKeyUsage[] = await reactScanAdapter.extractUsedKeys(context, createFs({ [`${projectRoot}/src/App.tsx`]: source }));
		expect(usages.map((usage: IKeyUsage): string => usage.key)).toEqual(['title', 'body']);
	});

	it('recognizes imported hook aliases, renamed t bindings, tuple bindings and namespace imports', async (): Promise<void> => {
		const source: string = `import { useTranslation as useI18n } from 'react-i18next';
import * as translations from 'react-i18next';
function App() {
	const { t: translate } = useI18n();
	const [tupleTranslate] = useI18n();
	const { t } = translations.useTranslation();
	return [translate('renamed'), tupleTranslate('tuple'), t('namespace-import')];
}`;
		const usages: IKeyUsage[] = await reactScanAdapter.extractUsedKeys(context, createFs({ [`${projectRoot}/src/App.ts`]: source }));
		expect(usages.map((usage: IKeyUsage): string => usage.key)).toEqual(['renamed', 'tuple', 'namespace-import']);
	});

	it('ignores unrelated t functions, sibling bindings, and shadowed t and hook parameters', async (): Promise<void> => {
		const source: string = `import { useTranslation } from 'react-i18next';
function App() {
	const { t } = useTranslation();
	function unrelated(t) { return t('shadowed-t'); }
	function localHook(useTranslation) { const { t } = useTranslation(); return t('shadowed-hook'); }
	{ const t = (key) => key; t('block-shadow'); }
	try {} catch (t) { t('catch-shadow'); }
	return t('actual');
}
function Sibling() { return t('outside-scope'); }
function Other() { const t = (key) => key; return t('unrelated'); }
const object = { t: (key) => key }; object.t('method');`;
		const usages: IKeyUsage[] = await reactScanAdapter.extractUsedKeys(context, createFs({ [`${projectRoot}/src/App.jsx`]: source }));
		expect(usages.map((usage: IKeyUsage): string => usage.key)).toEqual(['actual']);
	});

	it.each([
		'function useTranslation() { return { t: (key) => key }; }',
		"import { useTranslation } from 'another-library';",
		"import type { useTranslation } from 'react-i18next';"
	])('ignores hooks without a runtime react-i18next import: %s', async (hook: string): Promise<void> => {
		const source: string = `${hook} function App() { const { t } = useTranslation(); return t('unrelated'); }`;
		expect(await reactScanAdapter.extractUsedKeys(context, createFs({ [`${projectRoot}/src/App.ts`]: source }))).toEqual([]);
	});

	it('recognizes literals and retains dynamic arguments while ignoring comments and source strings', async (): Promise<void> => {
		const source: string = `import { useTranslation } from 'react-i18next';
function App(key) {
	const { t } = useTranslation();
	// t('comment');
	const text = "t('text')";
	return [t('single'), t("double"), t(\`template\`), t('prefix.' + key), t(\`prefix.\${key}\`), t(key), t()];
}`;
		const usages: IKeyUsage[] = await reactScanAdapter.extractUsedKeys(context, createFs({ [`${projectRoot}/src/App.ts`]: source }));
		expect(usages.filter((usage: IKeyUsage): boolean => !usage.isDynamic).map((usage: IKeyUsage): string => usage.key)).toEqual(['single', 'double', 'template']);
		expect(usages.filter((usage: IKeyUsage): boolean | undefined => usage.isDynamic)).toHaveLength(3);
	});

	it('respects custom source globs and excludes', async (): Promise<void> => {
		const source: string = "import { useTranslation } from 'react-i18next'; function App() { const { t } = useTranslation(); return t('title'); }";
		const fs: IFileSystemAdapter = createFs({ [`${projectRoot}/src/App.tsx`]: source, [`${projectRoot}/src/skip.tsx`]: source, [`${projectRoot}/other/Other.jsx`]: source });
		const config: IScannerConfig = { ...DEFAULT_SCANNER_CONFIG, includeSourceGlobs: ['src/**/*.tsx'], excludeGlobs: ['**/skip.tsx'] };
		const usages: IKeyUsage[] = await reactScanAdapter.extractUsedKeys({ projectRoot, config }, fs);
		expect(usages.map((usage: IKeyUsage): string => usage.filePath)).toEqual([`${projectRoot}/src/App.tsx`]);
	});

	it('collects only configured JSON resources and reports used, unused and missing keys', async (): Promise<void> => {
		const fs: IFileSystemAdapter = createFs({
			[`${projectRoot}/package.json`]: packageJson,
			[`${projectRoot}/locales/en.json`]: '{"app":{"title":"Title","unused":"Unused"}}',
			[`${projectRoot}/locales/ignored.yaml`]: 'ignored: true',
			[`${projectRoot}/node_modules/library/locales/en.json`]: '{"unrelated":"Ignore"}',
			[`${projectRoot}/src/App.tsx`]:
				"import { useTranslation } from 'react-i18next'; function App() { const { t } = useTranslation(); return <h1>{t('app.title')}{t('app.missing')}</h1>; }"
		});
		const result: IProjectScanResult = await runScan({ projectRoot, fs, registry: new AdapterRegistry([reactScanAdapter]) });
		expect(result.adapterId).toBe('react');
		expect(result.summary).toMatchObject({ totalKeys: 2, used: 1, unused: 1, missingInLanguage: 1, totalFindings: 3 });
		expect(result.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ adapterId: 'react', key: 'app.title', status: 'used', evidence: [expect.objectContaining({ filePath: `${projectRoot}/src/App.tsx` })] }),
				expect.objectContaining({ adapterId: 'react', key: 'app.unused', status: 'unused', severity: 'warning' }),
				expect.objectContaining({ adapterId: 'react', key: 'app.missing', status: 'missing-in-language', language: 'en', severity: 'error' })
			])
		);
		expect(result.translationMatrix).toMatchObject({ locales: ['en'], totalKeys: 2 });
	});

	it('honors translation source globs and merges configured filesystem sources in order', async (): Promise<void> => {
		const fs: IFileSystemAdapter = createFs({
			[`${projectRoot}/package.json`]: packageJson,
			[`${projectRoot}/base/en.json`]: '{"title":"Original","nested":{"kept":"Keep"}}',
			[`${projectRoot}/override/en.json`]: '{"title":"Override"}',
			[`${projectRoot}/locales/en.json`]: '{"ignored":"Ignore"}'
		});
		const config: IScannerConfig = {
			...DEFAULT_SCANNER_CONFIG,
			translationSources: [
				{ type: 'filesystem' as const, includeGlobs: ['base/*.json'] },
				{ type: 'filesystem' as const, includeGlobs: ['override/*.json'] }
			]
		};
		const result: IProjectScanResult = await runScan({ projectRoot, fs, config, registry: new AdapterRegistry([reactScanAdapter]) });
		expect(result.translationMatrix?.rows).toEqual([
			expect.objectContaining({ key: 'nested.kept', values: { en: 'Keep' } }),
			expect.objectContaining({ key: 'title', values: { en: 'Override' } })
		]);
	});

	it('reports locale coverage with the configured reference locale', async (): Promise<void> => {
		const fs: IFileSystemAdapter = createFs({
			[`${projectRoot}/package.json`]: packageJson,
			[`${projectRoot}/locales/en.json`]: '{"title":"Title"}',
			[`${projectRoot}/locales/de.json`]: '{"extra":"Zusatz"}'
		});
		const result: IProjectScanResult = await runScan({
			projectRoot,
			fs,
			config: { ...DEFAULT_SCANNER_CONFIG, baseLocale: 'en' },
			registry: new AdapterRegistry([reactScanAdapter])
		});
		expect(result.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: 'title', language: 'de', status: 'missing-in-language' }),
				expect.objectContaining({ key: 'extra', language: 'de', status: 'extra-in-language' })
			])
		);
	});

	it('preserves structured errors for invalid translation JSON', async (): Promise<void> => {
		const fs: IFileSystemAdapter = createFs({ [`${projectRoot}/package.json`]: packageJson, [`${projectRoot}/locales/en.json`]: '{invalid json' });
		await expect(runScan({ projectRoot, fs, registry: new AdapterRegistry([reactScanAdapter]) })).rejects.toMatchObject({
			code: 'translation-file-invalid-json',
			filePath: `${projectRoot}/locales/en.json`
		});
	});
});
