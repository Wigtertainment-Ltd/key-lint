import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SCANNER_CONFIG } from '../../config/scanner-defaults.js';
import { IFileSystemAdapter, IKeyUsage, IProjectContext, IAdapterDetectionResult } from '../scan-adapter.interface.js';
import { angularScanAdapter } from './angular-scan.adapter.js';
import { IFinding } from '../../models/finding.model.js';
import { ITranslationMatrix, ITranslationMatrixRow } from '../../models/scan-result.model.js';
import { ITranslationResource, ITranslationResourceOrigin } from '../../models/translation-resource.model.js';
import { IRemoteTranslationFetchRequest } from '../../remote/remote-translation.interfaces.js';

class InMemoryFsAdapter implements IFileSystemAdapter {
	constructor(private readonly files: Record<string, string>) { }

	fileExists(filePath: string): Promise<boolean> {
		return Promise.resolve(this.files[filePath] !== undefined);
	}

	async readFile(filePath: string): Promise<string> {
		const value: string = this.files[filePath];
		if (value === undefined) {
			throw new Error(`File not found: ${filePath}`);
		}

		return Promise.resolve(value);
	}

	listFiles(projectRoot: string, includeGlobs: string[], excludeGlobs: string[]): Promise<string[]> {
		// Convert every Windows path separator to the forward-slash form used by fixture paths.
		const normalizedRoot: string = projectRoot.replace(/\\/g, '/');
		const all: string[] = Object.keys(this.files).filter((file: string): boolean => file.startsWith(normalizedRoot));

		const matchesPattern: (filePath: string, pattern: string) => boolean = (filePath: string, pattern: string): boolean => {
			const escaped: string = pattern
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

		return Promise.resolve(all.filter((filePath: string): boolean => {
			const relative: string = filePath.replace(`${normalizedRoot}/`, '');
			const included: boolean =
				includeGlobs.some((glob: string): boolean => matchesPattern(filePath, glob)) ||
				includeGlobs.some((glob: string): boolean => matchesPattern(relative, glob));
			const excluded: boolean =
				excludeGlobs.some((glob: string): boolean => matchesPattern(filePath, glob)) ||
				excludeGlobs.some((glob: string): boolean => matchesPattern(relative, glob));
			return included && !excluded;
		}));
	}
}

function runRules(definedKeys: string[], usedKeys: IKeyUsage[], context: IProjectContext): ReturnType<typeof angularScanAdapter.runRules> {
	return angularScanAdapter.runRules({
		definedKeys,
		usedKeys,
		translationMatrix: { locales: [], rows: [], totalKeys: 0 },
		baseLocaleSelectionSource: 'none',
		context
	});
}

describe('angularScanAdapter', (): void => {
	const projectRoot: string = 'workspace/project';
	let context: IProjectContext;

	beforeEach((): void => {
		context = {
			projectRoot,
			config: DEFAULT_SCANNER_CONFIG
		};
	});

	it('detects angular projects via angular.json marker', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/package.json': '{"dependencies":{"@angular/core":"18.1.0"}}'
		});

		const result: IAdapterDetectionResult = await angularScanAdapter.detect(projectRoot, fs);

		expect(result.supported).toBeTrue();
		expect(result.confidence).toBe(1);
		expect(result.resolvedProjectRoot).toBe(projectRoot);
	});

	it('keeps a selected Angular project inside its enclosing Nx workspace', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/mono/nx.json': '{"npmScope":"demo"}',
			'workspace/mono/package.json': '{"dependencies":{"@angular/core":"18.1.0"},"devDependencies":{"@nx/angular":"19.0.0"}}',
			'workspace/mono/apps/admin/project.json': '{"name":"admin"}'
		});

		const nestedSelection: string = 'workspace/mono/apps/admin';
		const result: IAdapterDetectionResult = await angularScanAdapter.detect(nestedSelection, fs);

		expect(result.supported).toBeTrue();
		expect(result.confidence).toBe(0.85);
		expect(result.resolvedProjectRoot).toBe(nestedSelection);
	});

	it('resolves a source directory to its closest project instead of an enclosing workspace', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/mono/nx.json': '{}',
			'workspace/mono/package.json': '{"dependencies":{"@angular/core":"18.1.0"}}',
			'workspace/mono/apps/admin/project.json': '{"name":"admin"}'
		});
		const result: IAdapterDetectionResult = await angularScanAdapter.detect('workspace/mono/apps/admin/src', fs);
		expect(result.resolvedProjectRoot).toBe('workspace/mono/apps/admin');
	});

	it('detects the Nx workspace when the selected subtree has no project markers', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/mono/nx.json': '{}',
			'workspace/mono/package.json': '{"dependencies":{"@angular/core":"18.1.0"}}'
		});
		const result: IAdapterDetectionResult = await angularScanAdapter.detect('workspace/mono/apps/admin/src', fs);
		expect(result).toMatchObject({ supported: true, confidence: 0.9, resolvedProjectRoot: 'workspace/mono' });
	});

	it('discovers keys, usages, and rules for static and missing keys', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"GENERIC":{"HELLO":"Hello","BYE":"Bye"}}',
			'workspace/project/src/app/sample.component.html': "{{ 'GENERIC.HELLO' | translate }}",
			'workspace/project/src/app/sample.component.ts': "this.translateService.instant('GENERIC.MISSING');"
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys: string[] = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings: IFinding[] = await runRules(definedKeys, usedKeys, context);

		expect(translationFiles).toHaveLength(1);
		expect(definedKeys).toContain('GENERIC.HELLO');
		expect(definedKeys).toContain('GENERIC.BYE');
		expect(usedKeys.some((item: IKeyUsage): boolean => item.key === 'GENERIC.HELLO')).toBeTrue();

		expect(findings.some((item: IFinding): boolean => item.status === 'used' && item.key === 'GENERIC.HELLO')).toBeTrue();
		expect(findings.some((item: IFinding): boolean => item.status === 'unused' && item.key === 'GENERIC.BYE')).toBeTrue();
		expect(findings.some((item: IFinding): boolean => item.status === 'missing-in-language' && item.key === 'GENERIC.MISSING')).toBeTrue();
	});

	it.each(['translateService', 'translationService', 'languageService', 'labels'])('detects keys passed to %s.instant', async (serviceName: string): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/src/assets/i18n/en.json': JSON.stringify({
				ATTENDANCE: { START: 'Start', END: 'End', BREAKS: 'Breaks', CAPTUREZONE: 'Time zone', ACTIONS: 'Actions' }
			}),
			'workspace/project/src/app/sample.component.ts': `export class SampleComponent {
				readonly tableConfig = computed<TableConfig<IAttendanceDto>>(() => {
					this.language();
					return { columns: [
						{ field: 'startedAt', text: this.${serviceName}.instant('ATTENDANCE.START', { offset: hours + minutes }) },
						{ field: 'endedAt', text: this.${serviceName}.instant('ATTENDANCE.END') },
						{ field: 'breaks', text: this.${serviceName}.instant('ATTENDANCE.BREAKS') },
						{ field: 'timeZone', text: this.${serviceName}.instant('ATTENDANCE.CAPTUREZONE') },
						{ field: 'attendanceId', text: this.${serviceName}.instant('ATTENDANCE.ACTIONS') }
					] };
				});
				getLabel(field: string) {
					return this.${serviceName}.instant('ATTENDANCE.' + field);
				}
			}`
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys: string[] = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings: IFinding[] = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.filter((usage: IKeyUsage): boolean => !usage.isDynamic).map((usage: IKeyUsage): string => usage.key).sort()).toEqual([
			'ATTENDANCE.ACTIONS',
			'ATTENDANCE.BREAKS',
			'ATTENDANCE.CAPTUREZONE',
			'ATTENDANCE.END',
			'ATTENDANCE.START'
		]);
		expect(usedKeys.filter((usage: IKeyUsage): boolean => usage.isDynamic)).toMatchObject([
			{ key: "'ATTENDANCE.' + field" }
		]);
		expect(findings.filter((finding: IFinding): boolean => finding.status === 'used')).toHaveLength(5);
		expect(findings.filter((finding: IFinding): boolean => finding.status === 'unused' || finding.status === 'missing-in-language')).toEqual([]);
	});

	it.each(['workspace/project', 'F:/workspace/project', '/workspace/project'])('resolves ngx-translate wrappers across files under %s', async (root: string): Promise<void> => {
		const wrapperContext: IProjectContext = { ...context, projectRoot: root };
		const filePath: string = `${root}/src/app/sample.component.ts`;
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			[`${root}/src/assets/i18n/en.json`]: JSON.stringify({
				APP: { TITLE: 'Hello {{ name }}', SUBTITLE: 'Welcome {{ name }}', DEFAULT: 'Hi {{ name }}', UNUSED: 'Unused' }
			}),
			[`${root}/src/app/labels.service.ts`]: `
				import { TranslateService as Translator } from '@ngx-translate/core';

				export class Labels {
					constructor(private readonly service: Translator) {}

					labelFor(params: object = { name: 'Default' }, key: string): string {
						return this.service.instant(key, params);
					}

					translate(scope: string, key: string, params?: object): string {
						return this.service.instant(key, params);
					}
				}

				export class Other {
					labelFor(params: object, key: string): string { return key; }
				}
			`,
			[filePath]: `
				import { inject as useService } from '@angular/core';
				import { Labels as Messages, Other } from './labels.service.js';

				export class Screen {
					private readonly labels = useService(Messages);
					constructor(private readonly messages: Messages, private readonly other: Other) {}

					read(key: string): string[] {
						return [
							this.labels.labelFor({ name: 'Reader' }, 'APP.TITLE'),
							this.messages.translate('scope', 'APP.SUBTITLE', { name: 'Reader' }),
							this.messages.translate('dynamic-scope', key, { name: 'Reader' }),
							this.labels.labelFor(undefined, 'APP.DEFAULT'),
							this.labels.labelFor({}, 'APP.MISSING'),
							this.other.labelFor({}, 'APP.UNUSED')
						];
					}
				}
			`
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(wrapperContext, fs);
		const definedKeys: string[] = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const translationMatrix: ITranslationMatrix = await angularScanAdapter.buildTranslationMatrix(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(wrapperContext, fs, definedKeys);
		const findings: IFinding[] = await angularScanAdapter.runRules({ definedKeys, usedKeys, translationMatrix, baseLocale: 'en', context: wrapperContext });

		expect(usedKeys).toMatchObject([
			{ key: 'APP.TITLE', filePath, placeholderParameters: { kind: 'static', names: ['name'] } },
			{ key: 'APP.SUBTITLE', filePath, placeholderParameters: { kind: 'static', names: ['name'] } },
			{ key: 'APP.DEFAULT', filePath, placeholderParameters: { kind: 'static', names: ['name'] } },
			{ key: 'APP.MISSING', filePath, placeholderParameters: { kind: 'static', names: [] } }
		]);
		expect(findings).toMatchObject([
			{ key: 'APP.DEFAULT', status: 'used' },
			{ key: 'APP.MISSING', status: 'missing-in-language', language: 'en' },
			{ key: 'APP.SUBTITLE', status: 'used' },
			{ key: 'APP.TITLE', status: 'used' },
			{ key: 'APP.UNUSED', status: 'unused' }
		]);
	});

	it('detects keys used via translate method call in TypeScript', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"administration":{"groups":{"deactivate":{"success":"Done"}}}}',
			'workspace/project/src/app/sample.component.ts':
				"this.snackbarService.success(this.languageService.translate('administration.groups.deactivate.success'));"
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys: string[] = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings: IFinding[] = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item: IKeyUsage): boolean => item.key === 'administration.groups.deactivate.success')).toBeTrue();
		expect(
			findings.some(
				(item: IFinding): boolean => item.status === 'used' && item.key === 'administration.groups.deactivate.success'
			)
		).toBeTrue();
		expect(
			findings.some(
				(item: IFinding): boolean => item.status === 'unused' && item.key === 'administration.groups.deactivate.success'
			)
		).toBeFalse();
	});

	it('detects keys used via translate call on a generic service accessor', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"administration":{"groups":{"deactivate":{"error":"Failed"}}}}',
			'workspace/project/src/app/sample.component.ts':
				"DecoratorService.getService<SnackbarService>(AppDecoratorServiceKeys.snackbarService).error(DecoratorService.getService<LanguageService>(AppDecoratorServiceKeys.languageService).translate('administration.groups.deactivate.error'));"
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys: string[] = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings: IFinding[] = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item: IKeyUsage): boolean => item.key === 'administration.groups.deactivate.error')).toBeTrue();
		expect(
			findings.some(
				(item: IFinding): boolean => item.status === 'used' && item.key === 'administration.groups.deactivate.error'
			)
		).toBeTrue();
		expect(
			findings.some(
				(item: IFinding): boolean => item.status === 'unused' && item.key === 'administration.groups.deactivate.error'
			)
		).toBeFalse();
	});

	it('detects both keys used inside a ternary translate argument', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json':
				'{"administration":{"groups":{"membership":{"active":"Active","inactive":"Inactive"}}}}',
			'workspace/project/src/app/sample.component.ts':
				"this.isActiveText = languageService.translate(this.isActive ? 'administration.groups.membership.active' : 'administration.groups.membership.inactive');"
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys: string[] = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings: IFinding[] = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item: IKeyUsage): boolean => item.key === 'administration.groups.membership.active')).toBeTrue();
		expect(usedKeys.some((item: IKeyUsage): boolean => item.key === 'administration.groups.membership.inactive')).toBeTrue();
		expect(
			findings.some(
				(item: IFinding): boolean => item.status === 'used' && item.key === 'administration.groups.membership.active'
			)
		).toBeTrue();
		expect(
			findings.some(
				(item: IFinding): boolean => item.status === 'used' && item.key === 'administration.groups.membership.inactive'
			)
		).toBeTrue();
	});

	it('detects both result branches of ternaries piped to translate in property bindings', async (): Promise<void> => {
		const filePath: string = 'workspace/project/src/app/sample.component.html';
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/src/assets/i18n/en.json': JSON.stringify({
				ATTENDANCE: { EDITOR: { LATER: 'Later', CANCEL: 'Cancel', RETRY: 'Retry' }, DELETE: { ACTION: 'Delete' } }
			}),
			'workspace/project/src/assets/i18n/de.json': JSON.stringify({
				ATTENDANCE: { EDITOR: { LATER: 'Später', CANCEL: 'Abbrechen' }, DELETE: { ACTION: 'Löschen' } }
			}),
			[filePath]: `<div class="delete-actions">
				<wig-button severity="secondary" [disabled]="current.kind === 'saving'" (click)="visible.set(false)"
					[label]="(current.kind === 'uncertain' ? 'ATTENDANCE.EDITOR.LATER' : 'ATTENDANCE.EDITOR.CANCEL') | translate" />
				@if (current.kind !== 'rejected') {
					<wig-button severity="danger" [loading]="current.kind === 'saving'" (click)="confirm()"
						[label]="(current.kind === 'uncertain' ? 'ATTENDANCE.EDITOR.RETRY' : 'ATTENDANCE.DELETE.ACTION') | translate" />
				}
			</div>`
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys: string[] = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const translationMatrix: ITranslationMatrix = await angularScanAdapter.buildTranslationMatrix(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings: IFinding[] = await angularScanAdapter.runRules({ definedKeys, usedKeys, translationMatrix, baseLocale: 'en', context });

		expect(usedKeys.map((usage: IKeyUsage): string => usage.key).sort()).toEqual([
			'ATTENDANCE.DELETE.ACTION',
			'ATTENDANCE.EDITOR.CANCEL',
			'ATTENDANCE.EDITOR.LATER',
			'ATTENDANCE.EDITOR.RETRY'
		]);
		expect(findings.filter((finding: IFinding): boolean => finding.status === 'used')).toHaveLength(4);
		expect(findings.filter((finding: IFinding): boolean => finding.status === 'unused')).toEqual([]);
		expect(findings.filter((finding: IFinding): boolean => finding.status === 'missing-in-language')).toMatchObject([
			{ key: 'ATTENDANCE.EDITOR.RETRY', language: 'de', evidence: [{ filePath, line: 6 }] }
		]);
	});

	it('reads nested literal results and pipe parameters from a ternary binding in an inline template', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/src/app/sample.component.ts': `@Component({ template: \`
				<wig-button [label]='(ready || retry ? "APP.READY" : (blocked ? "APP.BLOCKED" : fallback)) | translate: { name: value } | uppercase' />
				<wig-button [label]="(ready ? 'APP.NO_PIPE' : 'APP.OTHER') | uppercase" />
				<wig-button [label]="ready ? 'APP.NOT_TRANSLATED' : fallback | translate" />
			\` }) export class SampleComponent {}`
		});

		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		expect(usedKeys).toMatchObject([
			{ key: 'APP.READY', isDynamic: false, placeholderParameters: { kind: 'static', names: ['name'] } },
			{ key: 'APP.BLOCKED', isDynamic: false, placeholderParameters: { kind: 'static', names: ['name'] } }
		]);
	});

	it('detects translate pipe keys inside an inline component template in a TS file', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"administration":{"groups":{"archived":"Archived"}}}',
			'workspace/project/src/app/sample.component.ts':
				"@Component({ template: `<wig-tab heading=\"{{ 'administration.groups.archived' | translate }}\" (onSelected)=\"tabActiveSelected(true)\" #tabArchived></wig-tab>` }) export class SampleComponent {}"
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys: string[] = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings: IFinding[] = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item: IKeyUsage): boolean => item.key === 'administration.groups.archived')).toBeTrue();
		expect(
			findings.some(
				(item: IFinding): boolean => item.status === 'used' && item.key === 'administration.groups.archived'
			)
		).toBeTrue();
		expect(
			findings.some(
				(item: IFinding): boolean => item.status === 'unused' && item.key === 'administration.groups.archived'
			)
		).toBeFalse();
	});

	it('detects transloco pipe keys in HTML templates', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"APP":{"TITLE":"Title","SUBTITLE":"Subtitle"}}',
			'workspace/project/src/app/sample.component.html':
				"<h1>{{ 'APP.TITLE' | transloco }}</h1><p [title]=\"'APP.SUBTITLE' | transloco\"></p>"
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys: string[] = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings: IFinding[] = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item: IKeyUsage): boolean => item.key === 'APP.TITLE')).toBeTrue();
		expect(usedKeys.some((item: IKeyUsage): boolean => item.key === 'APP.SUBTITLE')).toBeTrue();
		expect(findings.some((item: IFinding): boolean => item.status === 'used' && item.key === 'APP.TITLE')).toBeTrue();
		expect(findings.some((item: IFinding): boolean => item.status === 'used' && item.key === 'APP.SUBTITLE')).toBeTrue();
		expect(findings.some((item: IFinding): boolean => item.status === 'unused')).toBeFalse();
	});

	it('detects transloco structural directive calls in HTML templates', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json':
				'{"APP":{"TITLE":"Title","SUBTITLE":"Subtitle","UNUSED":"Unused"}}',
			'workspace/project/src/app/sample.component.html':
				"<ng-container *transloco=\"let t\"><h1>{{ t('APP.TITLE') }}</h1><p>{{ t('APP.SUBTITLE') }}</p></ng-container>"
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys: string[] = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings: IFinding[] = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item: IKeyUsage): boolean => item.matchType === 'html-transloco-structural-call')).toBeTrue();
		expect(findings.some((item: IFinding): boolean => item.status === 'used' && item.key === 'APP.TITLE')).toBeTrue();
		expect(findings.some((item: IFinding): boolean => item.status === 'used' && item.key === 'APP.SUBTITLE')).toBeTrue();
		expect(findings.some((item: IFinding): boolean => item.status === 'unused' && item.key === 'APP.UNUSED')).toBeTrue();
	});

	it('classifies keys built via translate concatenation as dynamic, not unused', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json':
				'{"dynamicFilter":{"DynamicFilterOperator":{"EQUALS":"=","EQUALS_NOT":"!="}}}',
			'workspace/project/src/app/sample.component.ts':
				"label: this.languageService.translate('dynamicFilter.DynamicFilterOperator.' + val)"
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys: string[] = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings: IFinding[] = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item: IKeyUsage): boolean | undefined => item.isDynamic && item.matchType === 'ts-dynamic-translate-call')).toBeTrue();
		expect(
			usedKeys.some((item: IKeyUsage): boolean => !item.isDynamic && item.key === 'dynamicFilter.DynamicFilterOperator.')
		).toBeFalse();
		expect(
			findings.some(
				(item: IFinding): boolean => item.status === 'dynamic-uncertain' && item.key === 'dynamicFilter.DynamicFilterOperator.EQUALS_NOT'
			)
		).toBeTrue();
		expect(
			findings.some(
				(item: IFinding): boolean => item.status === 'dynamic-uncertain' && item.key === 'dynamicFilter.DynamicFilterOperator.EQUALS'
			)
		).toBeTrue();
		expect(
			findings.some(
				(item: IFinding): boolean =>
					item.status === 'unused' &&
					(item.key === 'dynamicFilter.DynamicFilterOperator.EQUALS' ||
						item.key === 'dynamicFilter.DynamicFilterOperator.EQUALS_NOT')
			)
		).toBeFalse();
		expect(findings.some((item: IFinding): boolean => item.status === 'missing-in-language')).toBeFalse();
	});

	it('matches dynamic keys with literal parts before, between, and after runtime values', async (): Promise<void> => {
		const matchedKeys: string[] = [
			'SETTING.SECURITY.LABEL', 'SETTING.SECURITY.DESCRIPTION', 'PROFILE.PRIVACY.HELP',
			'MENU.ACCOUNT', 'PAGE.STATUS.READY', 'PROJECT.DASH.SETTINGS.TITLE', 'SECTION.MAIN.HEADING'
		];
		const unusedKeys: string[] = [
			'SETTING.SECURITY.INTERNAL', 'APP.SETTING.SECURITY.LABEL', 'PROFILE.PRIVACY.HELP.EXTRA',
			'PROJECT.BOARD.SETTINGS.TITLE', 'PROJECT.DASH.SETTINGS.TITLE.EXTRA', 'SECTION.MAIN.INTERNAL'
		];
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/src/app/sample.component.ts': `
				translationService.instant(\`SETTING.\${dto.key.toUpperCase()}.LABEL\`);
				translationService.instant(\`SETTING.\${dto.key.toUpperCase()}.DESCRIPTION\`);
				translationService.instant(\`\${context}.PRIVACY.HELP\`);
				translationService.instant(\`MENU.\${section}\`);
				translationService.instant(page + '.STATUS.READY');
				translationService.instant(project + '.DASH.' + panel + '.TITLE');
				translationService.instant(\`\${unknown}\`);
			`,
			'workspace/project/src/app/sample.component.html': `<h1 [title]="'SECTION.' + section + '.HEADING' | translate"></h1>`
		});

		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs, [...matchedKeys, ...unusedKeys]);
		const findings: IFinding[] = await runRules([...matchedKeys, ...unusedKeys], usedKeys, context);
		const findingsByKey: Map<string, IFinding> = new Map<string, IFinding>(findings.map((finding: IFinding): [string, IFinding] => [finding.key, finding]));

		for (const key of matchedKeys) {
			expect(findingsByKey.get(key), key).toMatchObject({ status: 'dynamic-uncertain', severity: 'info' });
		}
		for (const key of unusedKeys) {
			expect(findingsByKey.get(key), key).toMatchObject({ status: 'unused' });
		}
	});

	it('classifies indirect key literals in TypeScript object configs as indirect-uncertain', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json':
				'{"editor":{"traits":{"subTemplateSelector":{"buttonLink":{"optionLabel":"Option","buttonLabel":"Button","multiLinkLabel":"Multi Link"}}}}}',
			'workspace/project/src/app/sample.component.ts':
				"const config = { optionLabel: 'editor.traits.subTemplateSelector.buttonLink.optionLabel', options: [{ label: 'editor.traits.subTemplateSelector.buttonLink.buttonLabel' }, { label: 'editor.traits.subTemplateSelector.buttonLink.multiLinkLabel' }] };"
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys: string[] = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings: IFinding[] = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item: IKeyUsage): boolean => item.matchType === 'ts-indirect-key-literal')).toBeTrue();
		expect(
			findings.some(
				(item: IFinding): boolean =>
					item.status === 'indirect-uncertain' &&
					item.key === 'editor.traits.subTemplateSelector.buttonLink.buttonLabel'
			)
		).toBeTrue();
		expect(
			findings.some(
				(item: IFinding): boolean => item.status === 'unused' && item.key === 'editor.traits.subTemplateSelector.buttonLink.buttonLabel'
			)
		).toBeFalse();
	});

	it('classifies dynamic key expressions in pipe bindings as uncertain', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"main":{"recipients":{"recipient":{"import":{"recipientType":{"company":{"title":"Company"}}}}}}}',
			'workspace/project/src/app/sample.component.html':
				"<h3 [title]=\"'main.recipients.recipient.import.recipientType.' + recipientType() + '.title' | translate\"></h3>"
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys: string[] = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings: IFinding[] = await runRules(definedKeys, usedKeys, context);

		expect(usedKeys.some((item: IKeyUsage): boolean | undefined => item.isDynamic && item.matchType === 'html-dynamic-pipe-concat-binding')).toBeTrue();
		expect(
			findings.some(
				(item: IFinding): boolean =>
					item.status === 'dynamic-uncertain' &&
					item.key.includes("recipientType()")
			)
		).toBeTrue();
		expect(
			findings.some(
				(item: IFinding): boolean => item.status === 'missing-in-language' && item.key === '.title'
			)
		).toBeFalse();
	});

	it('keeps full dynamic translate expressions with nested method calls', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"metadata":{"selectCategory":{"news":{"local":{"label":"Local News"}}}}}',
			'workspace/project/src/app/sample.component.ts':
				"this.languageService.translate('metadata.selectCategory.' + category.fullPath.replace(/\\//g, '.') + '.label');"
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);
		const definedKeys: string[] = await angularScanAdapter.extractDefinedKeys(translationFiles, fs);
		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings: IFinding[] = await runRules(definedKeys, usedKeys, context);

		expect(
			usedKeys.some(
				(item: IKeyUsage): boolean | undefined =>
					item.isDynamic &&
					item.matchType === 'ts-dynamic-translate-call' &&
					item.key.includes("category.fullPath.replace(/\\//g, '.')") &&
					item.key.endsWith("+ '.label'")
			)
		).toBeTrue();

		expect(
			findings.some(
				(item: IFinding): boolean =>
					item.status === 'dynamic-uncertain' &&
					item.key === 'metadata.selectCategory.news.local.label'
			)
		).toBeTrue();
	});

	it('does not treat Cypress get calls as translation usage', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"GENERIC":{"HELLO":"Hello"}}',
			'workspace/project/cypress/e2e/setup-sender.cy.ts':
				"describe('Feature: Setup sender', () => { cy.get('wig-button').contains('Ok'); cy.get('div').contains('Sender successfully created.'); });"
		});

		const usedKeys: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);

		expect(usedKeys.some((item: IKeyUsage): boolean => item.key === 'wig-button')).toBeFalse();
		expect(usedKeys.some((item: IKeyUsage): boolean => item.key === 'div')).toBeFalse();
	});

	it('builds translation matrix with all locales and empty values for missing keys', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json':
				'{"COMMON":{"HELLO":"Hello","BYE":"Bye"},"PROFILE":{"TITLE":"Profile"}}',
			'workspace/project/src/assets/i18n/de.json':
				'{"COMMON":{"HELLO":"Hallo"},"PROFILE":{"TITLE":"Profil"}}'
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);
		const matrix: ITranslationMatrix | undefined = await angularScanAdapter.buildTranslationMatrix?.(translationFiles, fs);

		expect(matrix).toBeDefined();
		expect(matrix?.locales).toEqual(['de', 'en']);
		expect(matrix?.totalKeys).toBe(3);

		const byeRow: ITranslationMatrixRow | undefined = matrix?.rows.find((row: ITranslationMatrixRow): boolean => row.key === 'COMMON.BYE');
		expect(byeRow).toBeDefined();
		expect(byeRow?.values.en).toBe('Bye');
		expect(byeRow?.values.de).toBe('');
	});

	it('merges multiple files per locale when building matrix', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/common.en.json': '{"COMMON":{"OK":"OK"}}',
			'workspace/project/src/assets/i18n/feature.en.json': '{"FEATURE":{"NAME":"Feature"}}',
			'workspace/project/src/assets/i18n/common.fr.json': '{"COMMON":{"OK":"D\'accord"}}'
		});

		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);
		const matrix: ITranslationMatrix | undefined = await angularScanAdapter.buildTranslationMatrix?.(translationFiles, fs);

		expect(matrix?.locales).toEqual(['en', 'fr']);
		const commonRow: ITranslationMatrixRow | undefined = matrix?.rows.find((row: ITranslationMatrixRow): boolean => row.key === 'COMMON.OK');
		const featureRow: ITranslationMatrixRow | undefined = matrix?.rows.find((row: ITranslationMatrixRow): boolean => row.key === 'FEATURE.NAME');

		expect(commonRow?.values.en).toBe('OK');
		expect(commonRow?.values.fr).toBe('D\'accord');
		expect(featureRow?.values.en).toBe('Feature');
		expect(featureRow?.values.fr).toBe('');
	});

	it('collects stable writable resources for ordered filesystem sources', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/base/i18n/en.json': '{"APP":{"TITLE":"Title","BODY":"Body"}}',
			'workspace/project/src/override/i18n/en.json': '{"APP":{"TITLE":"Display title"}}'
		});
		context = {
			...context,
			config: {
				...DEFAULT_SCANNER_CONFIG,
				translationSources: [
					{ type: 'filesystem', id: 'base', includeGlobs: ['src/base/i18n/**/*.json'] },
					{ type: 'filesystem', id: 'override', includeGlobs: ['src/override/i18n/**/*.json'] }
				]
			}
		};

		const resources: ITranslationResource[] | undefined = await angularScanAdapter.collectTranslationResources?.(context, fs);

		expect(resources).toHaveLength(2);
		expect(resources?.map((entry: ITranslationResource): number => entry.position)).toEqual([0, 1]);
		expect(resources?.map((entry: ITranslationResource): string => entry.sourceId)).toEqual(['base', 'override']);
		expect(resources?.every((entry: ITranslationResource): boolean => entry.writable)).toBeTrue();
		expect(resources?.map((entry: ITranslationResource): ITranslationResourceOrigin => entry.origin)).toEqual([
			{ type: 'file', path: 'workspace/project/src/base/i18n/en.json' },
			{ type: 'file', path: 'workspace/project/src/override/i18n/en.json' }
		]);

		const matrix: ITranslationMatrix | undefined = resources
			? await angularScanAdapter.buildTranslationMatrixFromResources?.(resources)
			: undefined;
		expect(matrix?.rows.find((row: ITranslationMatrixRow): boolean => row.key === 'APP.TITLE')?.values.en).toBe('Display title');
		expect(matrix?.rows.find((row: ITranslationMatrixRow): boolean => row.key === 'APP.BODY')?.values.en).toBe('Body');
	});

	it('preserves mixed filesystem and HTTP source order', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/base/en.json': '{"APP":{"TITLE":"Base","BASE":"Base only"}}',
			'workspace/project/src/final/en.json': '{"APP":{"TITLE":"Final"}}'
		});
		context = {
			...context,
			config: {
				...DEFAULT_SCANNER_CONFIG,
				translationSources: [
					{ type: 'filesystem', id: 'base', includeGlobs: ['src/base/**/*.json'] },
					{ type: 'http', id: 'remote', urlTemplate: 'https://example.com/{locale}.json', locales: ['en'] },
					{ type: 'filesystem', id: 'final', includeGlobs: ['src/final/**/*.json'] }
				]
			},
			remoteTranslations: {
				allowNetwork: true,
				fetcher: {
					fetch: (request: IRemoteTranslationFetchRequest): Promise<{ body: string; finalUrl: string; }> => Promise.resolve({
						body: '{"APP":{"TITLE":"Remote","REMOTE":"Remote only"}}',
						finalUrl: request.url
					})
				}
			}
		};

		const resources: ITranslationResource[] | undefined = await angularScanAdapter.collectTranslationResources?.(context, fs);

		expect(resources?.map((entry: ITranslationResource): number => entry.position)).toEqual([0, 1, 2]);
		expect(resources?.map((entry: ITranslationResource): string => entry.sourceId)).toEqual(['base', 'remote', 'final']);
		expect(resources?.map((entry: ITranslationResource): boolean => entry.writable)).toEqual([true, false, true]);
		const matrix: ITranslationMatrix | undefined = resources
			? await angularScanAdapter.buildTranslationMatrixFromResources?.(resources)
			: undefined;
		expect(matrix?.rows.find((row: ITranslationMatrixRow): boolean => row.key === 'APP.TITLE')?.values.en).toBe('Final');
		expect(matrix?.rows.find((row: ITranslationMatrixRow): boolean => row.key === 'APP.REMOTE')?.values.en).toBe('Remote only');
	});

	it('fails key extraction when a translation file contains invalid JSON', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/src/assets/i18n/en.json': '{"APP":{"TITLE":"Title"}}',
			'workspace/project/src/assets/i18n/de.json': '{"APP":'
		});
		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);

		// Match the complete normalized fixture path while escaping regex-significant slashes and dots.
		await expect(angularScanAdapter.extractDefinedKeys(translationFiles, fs)).rejects.toThrowError(
			/Invalid JSON in translation file "workspace\/project\/src\/assets\/i18n\/de\.json"/
		);
	});

	it('fails matrix creation when a translation file has an array root', async (): Promise<void> => {
		const fs: InMemoryFsAdapter = new InMemoryFsAdapter({
			'workspace/project/src/assets/i18n/en.json': '[]'
		});
		const translationFiles: string[] = await angularScanAdapter.collectTranslationFiles(context, fs);

		await expect(angularScanAdapter.buildTranslationMatrix?.(translationFiles, fs)).rejects.toThrowError(
			'Translation file "workspace/project/src/assets/i18n/en.json" must contain a JSON object at the root.'
		);
	});
});
