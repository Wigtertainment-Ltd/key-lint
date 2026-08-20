import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SCANNER_CONFIG } from '../../config/scanner-defaults.js';
import {
	IFileSystemAdapter,
	IKeyUsage,
	IProjectContext
} from '../scan-adapter.interface.js';
import { angularScanAdapter } from './angular-scan.adapter.js';

class InMemoryFsAdapter implements IFileSystemAdapter {
	constructor(private readonly files: Record<string, string>) { }

	async fileExists(filePath: string): Promise<boolean> {
		return this.files[filePath] !== undefined;
	}

	async readFile(filePath: string): Promise<string> {
		const value = this.files[filePath];
		if (value === undefined) {
			throw new Error(`File not found: ${filePath}`);
		}

		return value;
	}

	async listFiles(projectRoot: string, includeGlobs: string[], excludeGlobs: string[]): Promise<string[]> {
		// Convert every Windows path separator to the forward-slash form used by fixture paths.
		const normalizedRoot = projectRoot.replace(/\\/g, '/');
		const all = Object.keys(this.files).filter((file) => file.startsWith(normalizedRoot));

		const matchesPattern = (filePath: string, pattern: string): boolean => {
			const escaped = pattern
				// Convert every Windows path separator before translating the glob.
				.replace(/\\/g, '/')
				// Escape regex metacharacters that are literal in a glob.
				.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
				// Preserve "**/" before processing single stars because it may match zero directories.
				.replace(/\*\*\//g, '__DOUBLE_STAR_SLASH__')
				// Preserve remaining globstars before converting single stars.
				.replace(/\*\*/g, '__DOUBLE_STAR__')
				// A single star matches characters only within one path segment.
				.replace(/\*/g, '[^/]*')
				// A globstar followed by a slash matches zero or more complete directory segments.
				.replace(/__DOUBLE_STAR_SLASH__/g, '(?:.*/)?')
				// A remaining globstar may match across directory boundaries.
				.replace(/__DOUBLE_STAR__/g, '.*');
			// Anchor the generated expression so the glob must match the complete fixture path.
			return new RegExp(`^${escaped}$`).test(filePath);
		};

		return all.filter((filePath) => {
			const relative = filePath.replace(`${normalizedRoot}/`, '');
			const included =
				includeGlobs.some((glob) => matchesPattern(filePath, glob)) ||
				includeGlobs.some((glob) => matchesPattern(relative, glob));
			const excluded =
				excludeGlobs.some((glob) => matchesPattern(filePath, glob)) ||
				excludeGlobs.some((glob) => matchesPattern(relative, glob));
			return included && !excluded;
		});
	}
}

function runRules(definedKeys: string[], usedKeys: IKeyUsage[], context: IProjectContext) {
	return angularScanAdapter.runRules({
		definedKeys,
		usedKeys,
		translationMatrix: { locales: [], rows: [], totalKeys: 0 },
		baseLocaleSelectionSource: 'none',
		context
	});
}

describe('angularScanAdapter', () => {
	const projectRoot = 'workspace/project';
	let context: IProjectContext;

	beforeEach(() => {
		context = {
			projectRoot,
			config: DEFAULT_SCANNER_CONFIG
		};
	});

	it('detects angular projects via angular.json marker', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/package.json': '{"dependencies":{"@angular/core":"18.1.0"}}'
		});

		const result = await angularScanAdapter.detect(projectRoot, fs);

		expect(result.supported).toBeTrue();
		expect(result.confidence).toBe(1);
		expect(result.resolvedProjectRoot).toBe(projectRoot);
	});

	it('detects angular monorepo when a nested project path is selected', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/mono/nx.json': '{"npmScope":"demo"}',
			'workspace/mono/package.json': '{"dependencies":{"@angular/core":"18.1.0"},"devDependencies":{"@nx/angular":"19.0.0"}}',
			'workspace/mono/apps/admin/project.json': '{"name":"admin"}'
		});

		const nestedSelection = 'workspace/mono/apps/admin';
		const result = await angularScanAdapter.detect(nestedSelection, fs);

		expect(result.supported).toBeTrue();
		expect(result.confidence).toBe(0.9);
		expect(result.resolvedProjectRoot).toBe('workspace/mono');
	});

	it('discovers keys, usages, and rules for static and missing keys', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"GENERIC":{"HELLO":"Hello","BYE":"Bye"}}',
			'workspace/project/src/app/sample.component.html': "{{ 'GENERIC.HELLO' | translate }}",
			'workspace/project/src/app/sample.component.ts': "this.translateService.instant('GENERIC.MISSING');"
		});

		const translationFiles = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings = await runRules(definedKeys, usedKeys, context);

		expect(translationFiles).toHaveLength(1);
		expect(definedKeys).toContain('GENERIC.HELLO');
		expect(definedKeys).toContain('GENERIC.BYE');
		expect(usedKeys.some((item) => item.key === 'GENERIC.HELLO')).toBeTrue();

		expect(findings.some((item) => item.status === 'used' && item.key === 'GENERIC.HELLO')).toBeTrue();
		expect(findings.some((item) => item.status === 'unused' && item.key === 'GENERIC.BYE')).toBeTrue();
		expect(findings.some((item) => item.status === 'missing-in-language' && item.key === 'GENERIC.MISSING')).toBeTrue();
	});

	it('detects keys used via translate method call in TypeScript', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"administration":{"groups":{"deactivate":{"success":"Done"}}}}',
			'workspace/project/src/app/sample.component.ts':
				"this.snackbarService.success(this.languageService.translate('administration.groups.deactivate.success'));"
		});

		const translationFiles = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item) => item.key === 'administration.groups.deactivate.success')).toBeTrue();
		expect(
			findings.some(
				(item) => item.status === 'used' && item.key === 'administration.groups.deactivate.success'
			)
		).toBeTrue();
		expect(
			findings.some(
				(item) => item.status === 'unused' && item.key === 'administration.groups.deactivate.success'
			)
		).toBeFalse();
	});

	it('detects keys used via translate call on a generic service accessor', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"administration":{"groups":{"deactivate":{"error":"Failed"}}}}',
			'workspace/project/src/app/sample.component.ts':
				"DecoratorService.getService<SnackbarService>(AppDecoratorServiceKeys.snackbarService).error(DecoratorService.getService<LanguageService>(AppDecoratorServiceKeys.languageService).translate('administration.groups.deactivate.error'));"
		});

		const translationFiles = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item) => item.key === 'administration.groups.deactivate.error')).toBeTrue();
		expect(
			findings.some(
				(item) => item.status === 'used' && item.key === 'administration.groups.deactivate.error'
			)
		).toBeTrue();
		expect(
			findings.some(
				(item) => item.status === 'unused' && item.key === 'administration.groups.deactivate.error'
			)
		).toBeFalse();
	});

	it('detects both keys used inside a ternary translate argument', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json':
				'{"administration":{"groups":{"membership":{"active":"Active","inactive":"Inactive"}}}}',
			'workspace/project/src/app/sample.component.ts':
				"this.isActiveText = languageService.translate(this.isActive ? 'administration.groups.membership.active' : 'administration.groups.membership.inactive');"
		});

		const translationFiles = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item) => item.key === 'administration.groups.membership.active')).toBeTrue();
		expect(usedKeys.some((item) => item.key === 'administration.groups.membership.inactive')).toBeTrue();
		expect(
			findings.some(
				(item) => item.status === 'used' && item.key === 'administration.groups.membership.active'
			)
		).toBeTrue();
		expect(
			findings.some(
				(item) => item.status === 'used' && item.key === 'administration.groups.membership.inactive'
			)
		).toBeTrue();
	});

	it('detects translate pipe keys inside an inline component template in a TS file', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"administration":{"groups":{"archived":"Archived"}}}',
			'workspace/project/src/app/sample.component.ts':
				"@Component({ template: `<wig-tab heading=\"{{ 'administration.groups.archived' | translate }}\" (onSelected)=\"tabActiveSelected(true)\" #tabArchived></wig-tab>` }) export class SampleComponent {}"
		});

		const translationFiles = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item) => item.key === 'administration.groups.archived')).toBeTrue();
		expect(
			findings.some(
				(item) => item.status === 'used' && item.key === 'administration.groups.archived'
			)
		).toBeTrue();
		expect(
			findings.some(
				(item) => item.status === 'unused' && item.key === 'administration.groups.archived'
			)
		).toBeFalse();
	});

	it('detects transloco pipe keys in HTML templates', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"APP":{"TITLE":"Title","SUBTITLE":"Subtitle"}}',
			'workspace/project/src/app/sample.component.html':
				"<h1>{{ 'APP.TITLE' | transloco }}</h1><p [title]=\"'APP.SUBTITLE' | transloco\"></p>"
		});

		const translationFiles = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item) => item.key === 'APP.TITLE')).toBeTrue();
		expect(usedKeys.some((item) => item.key === 'APP.SUBTITLE')).toBeTrue();
		expect(findings.some((item) => item.status === 'used' && item.key === 'APP.TITLE')).toBeTrue();
		expect(findings.some((item) => item.status === 'used' && item.key === 'APP.SUBTITLE')).toBeTrue();
		expect(findings.some((item) => item.status === 'unused')).toBeFalse();
	});

	it('detects transloco structural directive calls in HTML templates', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json':
				'{"APP":{"TITLE":"Title","SUBTITLE":"Subtitle","UNUSED":"Unused"}}',
			'workspace/project/src/app/sample.component.html':
				"<ng-container *transloco=\"let t\"><h1>{{ t('APP.TITLE') }}</h1><p>{{ t('APP.SUBTITLE') }}</p></ng-container>"
		});

		const translationFiles = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item) => item.matchType === 'html-transloco-structural-call')).toBeTrue();
		expect(findings.some((item) => item.status === 'used' && item.key === 'APP.TITLE')).toBeTrue();
		expect(findings.some((item) => item.status === 'used' && item.key === 'APP.SUBTITLE')).toBeTrue();
		expect(findings.some((item) => item.status === 'unused' && item.key === 'APP.UNUSED')).toBeTrue();
	});

	it('classifies keys built via translate concatenation as dynamic, not unused', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json':
				'{"dynamicFilter":{"DynamicFilterOperator":{"EQUALS":"=","EQUALS_NOT":"!="}}}',
			'workspace/project/src/app/sample.component.ts':
				"label: this.languageService.translate('dynamicFilter.DynamicFilterOperator.' + val)"
		});

		const translationFiles = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item) => item.isDynamic && item.matchType === 'ts-dynamic-translate-call')).toBeTrue();
		expect(
			usedKeys.some((item) => !item.isDynamic && item.key === 'dynamicFilter.DynamicFilterOperator.')
		).toBeFalse();
		expect(
			findings.some(
				(item) => item.status === 'dynamic-uncertain' && item.key === 'dynamicFilter.DynamicFilterOperator.EQUALS_NOT'
			)
		).toBeTrue();
		expect(
			findings.some(
				(item) => item.status === 'dynamic-uncertain' && item.key === 'dynamicFilter.DynamicFilterOperator.EQUALS'
			)
		).toBeTrue();
		expect(
			findings.some(
				(item) =>
					item.status === 'unused' &&
					(item.key === 'dynamicFilter.DynamicFilterOperator.EQUALS' ||
						item.key === 'dynamicFilter.DynamicFilterOperator.EQUALS_NOT')
			)
		).toBeFalse();
		expect(findings.some((item) => item.status === 'missing-in-language')).toBeFalse();
	});

	it('classifies indirect key literals in TypeScript object configs as indirect-uncertain', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json':
				'{"editor":{"traits":{"subTemplateSelector":{"buttonLink":{"optionLabel":"Option","buttonLabel":"Button","multiLinkLabel":"Multi Link"}}}}}',
			'workspace/project/src/app/sample.component.ts':
				"const config = { optionLabel: 'editor.traits.subTemplateSelector.buttonLink.optionLabel', options: [{ label: 'editor.traits.subTemplateSelector.buttonLink.buttonLabel' }, { label: 'editor.traits.subTemplateSelector.buttonLink.multiLinkLabel' }] };"
		});

		const translationFiles = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item) => item.matchType === 'ts-indirect-key-literal')).toBeTrue();
		expect(
			findings.some(
				(item) =>
					item.status === 'indirect-uncertain' &&
					item.key === 'editor.traits.subTemplateSelector.buttonLink.buttonLabel'
			)
		).toBeTrue();
		expect(
			findings.some(
				(item) => item.status === 'unused' && item.key === 'editor.traits.subTemplateSelector.buttonLink.buttonLabel'
			)
		).toBeFalse();
	});

	it('classifies dynamic key expressions in pipe bindings as uncertain', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"main":{"recipients":{"recipient":{"import":{"recipientType":{"company":{"title":"Company"}}}}}}}',
			'workspace/project/src/app/sample.component.html':
				"<h3 [title]=\"'main.recipients.recipient.import.recipientType.' + recipientType() + '.title' | translate\"></h3>"
		});

		const translationFiles = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item) => item.isDynamic && item.matchType === 'html-dynamic-pipe-concat-binding')).toBeTrue();
		expect(
			findings.some(
				(item) =>
					item.status === 'dynamic-uncertain' &&
					item.key.includes("recipientType()")
			)
		).toBeTrue();
		expect(
			findings.some(
				(item) => item.status === 'missing-in-language' && item.key === '.title'
			)
		).toBeFalse();
	});

	it('keeps full dynamic translate expressions with nested method calls', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"metadata":{"selectCategory":{"news":{"local":{"label":"Local News"}}}}}',
			'workspace/project/src/app/sample.component.ts':
				"this.languageService.translate('metadata.selectCategory.' + category.fullPath.replace(/\\//g, '.') + '.label');"
		});

		const translationFiles = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings = await runRules(definedKeys, usedKeys, context);

		expect(
			usedKeys.some(
				(item) =>
					item.isDynamic &&
					item.matchType === 'ts-dynamic-translate-call' &&
					item.key.includes("category.fullPath.replace(/\\//g, '.')") &&
					item.key.endsWith("+ '.label'")
			)
		).toBeTrue();

		expect(
			findings.some(
				(item) =>
					item.status === 'dynamic-uncertain' &&
					item.key === 'metadata.selectCategory.news.local.label'
			)
		).toBeTrue();
	});

	it('does not treat Cypress get calls as translation usage', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"GENERIC":{"HELLO":"Hello"}}',
			'workspace/project/cypress/e2e/setup-sender.cy.ts':
				"describe('Feature: Setup sender', () => { cy.get('wig-button').contains('Ok'); cy.get('div').contains('Sender successfully created.'); });"
		});

		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);

		expect(usedKeys.some((item) => item.key === 'wig-button')).toBeFalse();
		expect(usedKeys.some((item) => item.key === 'div')).toBeFalse();
	});

	it('builds translation matrix with all locales and empty values for missing keys', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json':
				'{"COMMON":{"HELLO":"Hello","BYE":"Bye"},"PROFILE":{"TITLE":"Profile"}}',
			'workspace/project/src/assets/i18n/de.json':
				'{"COMMON":{"HELLO":"Hallo"},"PROFILE":{"TITLE":"Profil"}}'
		});

		const translationFiles = await angularScanAdapter.collectTranslationFiles(context, fs);
		const matrix = await angularScanAdapter.buildTranslationMatrix?.(translationFiles, fs);

		expect(matrix).toBeDefined();
		expect(matrix?.locales).toEqual(['de', 'en']);
		expect(matrix?.totalKeys).toBe(3);

		const byeRow = matrix?.rows.find((row) => row.key === 'COMMON.BYE');
		expect(byeRow).toBeDefined();
		expect(byeRow?.values['en']).toBe('Bye');
		expect(byeRow?.values['de']).toBe('');
	});

	it('merges multiple files per locale when building matrix', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/common.en.json': '{"COMMON":{"OK":"OK"}}',
			'workspace/project/src/assets/i18n/feature.en.json': '{"FEATURE":{"NAME":"Feature"}}',
			'workspace/project/src/assets/i18n/common.fr.json': '{"COMMON":{"OK":"D\'accord"}}'
		});

		const translationFiles = await angularScanAdapter.collectTranslationFiles(context, fs);
		const matrix = await angularScanAdapter.buildTranslationMatrix?.(translationFiles, fs);

		expect(matrix?.locales).toEqual(['en', 'fr']);
		const commonRow = matrix?.rows.find((row) => row.key === 'COMMON.OK');
		const featureRow = matrix?.rows.find((row) => row.key === 'FEATURE.NAME');

		expect(commonRow?.values['en']).toBe('OK');
		expect(commonRow?.values['fr']).toBe('D\'accord');
		expect(featureRow?.values['en']).toBe('Feature');
		expect(featureRow?.values['fr']).toBe('');
	});

	it('fails key extraction when a translation file contains invalid JSON', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/src/assets/i18n/en.json': '{"APP":{"TITLE":"Title"}}',
			'workspace/project/src/assets/i18n/de.json': '{"APP":'
		});
		const translationFiles = await angularScanAdapter.collectTranslationFiles(context, fs);

		// Match the complete normalized fixture path while escaping regex-significant slashes and dots.
		await expect(angularScanAdapter.extractDefinedKeys(translationFiles, fs)).rejects.toThrowError(
			/Invalid JSON in translation file "workspace\/project\/src\/assets\/i18n\/de\.json"/
		);
	});

	it('fails matrix creation when a translation file has an array root', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/src/assets/i18n/en.json': '[]'
		});
		const translationFiles = await angularScanAdapter.collectTranslationFiles(context, fs);

		await expect(angularScanAdapter.buildTranslationMatrix?.(translationFiles, fs)).rejects.toThrowError(
			'Translation file "workspace/project/src/assets/i18n/en.json" must contain a JSON object at the root.'
		);
	});
});
