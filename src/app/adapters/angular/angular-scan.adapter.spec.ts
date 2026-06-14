/// <reference types="jasmine" />

import { DEFAULT_SCANNER_CONFIG } from '../../core/config/scanner-defaults';
import {
	FileSystemAdapter,
	KeyUsage,
	ProjectContext
} from '../../core/adapters/scan-adapter.interface';
import { angularScanAdapter } from './angular-scan.adapter';

class InMemoryFsAdapter implements FileSystemAdapter {
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
		const normalizedRoot = projectRoot.replace(/\\/g, '/');
		const all = Object.keys(this.files).filter((file) => file.startsWith(normalizedRoot));

		const matchesPattern = (filePath: string, pattern: string): boolean => {
			const escaped = pattern
				.replace(/\\/g, '/')
				.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
				.replace(/\*\*\//g, '__DOUBLE_STAR_SLASH__')
				.replace(/\*\*/g, '__DOUBLE_STAR__')
				.replace(/\*/g, '[^/]*')
				.replace(/__DOUBLE_STAR_SLASH__/g, '(?:.*/)?')
				.replace(/__DOUBLE_STAR__/g, '.*');
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

describe('angularScanAdapter', () => {
	const projectRoot = 'workspace/project';
	let context: ProjectContext;

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
		const usedKeys: KeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings = await angularScanAdapter.runRules({
			definedKeys,
			usedKeys,
			context
		});

		expect(translationFiles.length).toBe(1);
		expect(definedKeys).toContain('GENERIC.HELLO');
		expect(definedKeys).toContain('GENERIC.BYE');
		expect(usedKeys.some((item) => item.key === 'GENERIC.HELLO')).toBeTrue();

		expect(findings.some((item) => item.status === 'used' && item.key === 'GENERIC.HELLO')).toBeTrue();
		expect(findings.some((item) => item.status === 'unused' && item.key === 'GENERIC.BYE')).toBeTrue();
		expect(findings.some((item) => item.status === 'missing-in-language' && item.key === 'GENERIC.MISSING')).toBeTrue();
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
		const usedKeys: KeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const findings = await angularScanAdapter.runRules({
			definedKeys,
			usedKeys,
			context
		});

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

	it('does not treat Cypress get calls as translation usage', async () => {
		const fs = new InMemoryFsAdapter({
			'workspace/project/angular.json': '{"version":1}',
			'workspace/project/src/assets/i18n/en.json': '{"GENERIC":{"HELLO":"Hello"}}',
			'workspace/project/cypress/e2e/setup-sender.cy.ts':
				"describe('Feature: Setup sender', () => { cy.get('cosmos-button').contains('Ok'); cy.get('div').contains('Sender successfully created.'); });"
		});

		const usedKeys: KeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);

		expect(usedKeys.some((item) => item.key === 'cosmos-button')).toBeFalse();
		expect(usedKeys.some((item) => item.key === 'div')).toBeFalse();
	});
});
