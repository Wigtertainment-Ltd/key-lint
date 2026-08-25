import { Injectable } from '@angular/core';
import {
	expandAutoHttpTranslationSources, IFileSystemAdapter, IAutoHttpProjectAnalysis, IScannerConfig, ITranslationSourceConfig, normalizePath, parseScannerConfigOverrides,
	redactAutoHttpUrlTemplate, resolveAutoHttpCandidate
} from '@key-lint/core';
import type { ILoaderAnalysisSourceFile } from '@key-lint/core/detection';
import {
	IDesktopRemoteHeaderDraft, IDesktopTranslationSourceDraft, IPreparedDesktopRemoteScan, IRemoteScanConfirmation, IRemoteScanConfirmationSource
} from './desktop-remote-translation.interfaces';
import { cloneDraft, isPrivateOrLocalHostname } from './desktop-remote-translation.helper';

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

@Injectable({ providedIn: 'root' })
export class DesktopRemoteTranslationService {
	private drafts: IDesktopTranslationSourceDraft[] = [];
	private configuredDrafts: IDesktopTranslationSourceDraft[] = [];
	private autoAnalysis?: IAutoHttpProjectAnalysis;
	private sequence = 0;

	get sources(): IDesktopTranslationSourceDraft[] {
		return this.drafts.map(cloneDraft);
	}

	get hasRemoteSources(): boolean {
		return this.drafts.some((source) => source.type === 'http' || source.type === 'auto-http');
	}

	loadConfiguredSources(sources: ITranslationSourceConfig[] = [{ type: 'filesystem' }]): void {
		this.autoAnalysis = undefined;
		this.drafts = sources.map((source) => this.fromConfig(source));
		this.configuredDrafts = this.drafts.map(cloneDraft);
	}

	resetSources(): void {
		this.drafts = this.configuredDrafts.map(cloneDraft);
		this.clearSecrets();
	}

	clear(): void {
		this.clearSecrets();
		this.drafts = [];
		this.configuredDrafts = [];
		this.autoAnalysis = undefined;
	}

	clearSecrets(): void {
		for (const source of this.drafts) {
			for (const header of source.headers) {
				header.value = '';
			}
		}
	}

	addFilesystemSource(): void {
		this.drafts.push({
			draftId: this.nextId('source'),
			type: 'filesystem',
			id: '',
			includeGlobs: [],
			urlTemplate: '',
			origin: '',
			locales: [],
			headers: [],
			configured: false,
			autoCandidates: [],
			autoDiagnostics: []
		});
	}

	addHttpSource(): void {
		this.drafts.push({
			draftId: this.nextId('source'),
			type: 'http',
			id: '',
			includeGlobs: [],
			urlTemplate: '',
			origin: '',
			locales: [],
			headers: [],
			configured: false,
			autoCandidates: [],
			autoDiagnostics: []
		});
	}

	addAutoHttpSource(): void {
		this.drafts.push({
			draftId: this.nextId('source'), type: 'auto-http', id: '', includeGlobs: [], urlTemplate: '', origin: '',
			locales: [], headers: [], configured: false, autoCandidates: [], autoDiagnostics: []
		});
	}

	removeSource(draftId: string): void {
		this.drafts = this.drafts.filter((source) => source.draftId !== draftId);
	}

	moveSource(draftId: string, direction: -1 | 1): void {
		const index = this.drafts.findIndex((source) => source.draftId === draftId);
		const target = index + direction;
		if (index < 0 || target < 0 || target >= this.drafts.length) {
			return;
		}
		const [source] = this.drafts.splice(index, 1);
		this.drafts.splice(target, 0, source);
	}

	updateSource(draftId: string, updates: Partial<Pick<IDesktopTranslationSourceDraft, 'id' | 'includeGlobs' | 'urlTemplate' | 'origin' | 'locales'>>): void {
		const source = this.drafts.find((entry) => entry.draftId === draftId);
		if (!source) {
			return;
		}
		if (updates.id !== undefined) source.id = updates.id;
		if (updates.includeGlobs !== undefined) source.includeGlobs = [...updates.includeGlobs];
		if (updates.urlTemplate !== undefined) source.urlTemplate = updates.urlTemplate;
		if (updates.origin !== undefined) source.origin = updates.origin;
		if (updates.locales !== undefined) source.locales = [...updates.locales];
	}

	addTemporaryHeader(draftId: string): void {
		const source = this.drafts.find((entry) => entry.draftId === draftId && entry.type !== 'filesystem');
		if (!source) {
			return;
		}
		const id = this.nextId('header');
		source.headers.push({
			id,
			name: '',
			environmentName: `KEYLINT_DESKTOP_${id.toUpperCase().replaceAll('-', '_')}`,
			value: '',
			configured: false
		});
	}

	selectAutoCandidate(draftId: string, candidateIndex: number): void {
		const source = this.drafts.find((entry) => entry.draftId === draftId && entry.type === 'auto-http');
		if (source?.autoCandidates.some((candidate) => candidate.index === candidateIndex)) source.selectedCandidateIndex = candidateIndex;
	}

	async analyzeAutoSources(
		projectRoot: string,
		fs: IFileSystemAdapter,
		config: IScannerConfig,
		analyze: (files: ILoaderAnalysisSourceFile[]) => Promise<IAutoHttpProjectAnalysis>
	): Promise<void> {
		if (!this.drafts.some((source) => source.type === 'auto-http')) return;
		const paths = (await fs.listFiles(projectRoot, config.includeSourceGlobs, config.excludeGlobs))
			.map(normalizePath)
			.filter((filePath) => /\.tsx?$/i.test(filePath))
			.sort((left, right) => left.localeCompare(right));
		const files: ILoaderAnalysisSourceFile[] = [];
		for (const filePath of paths) files.push({ filePath, content: await fs.readFile(filePath) });
		this.autoAnalysis = await analyze(files);
		for (const source of this.drafts.filter((entry) => entry.type === 'auto-http')) {
			source.autoCandidates = this.autoAnalysis.candidates.map((candidate, index) => ({
				index,
				framework: candidate.framework,
				api: candidate.api,
				location: `${candidate.location.filePath}:${candidate.location.line}:${candidate.location.column}`,
				urlTemplates: candidate.resources.map((resource) => redactAutoHttpUrlTemplate(resource.urlTemplate)),
				locales: [...candidate.locales],
				requiresOrigin: candidate.resources.some((resource) => resource.requiresOrigin)
			}));
			source.autoDiagnostics = this.autoAnalysis.diagnostics.map((diagnostic) => ({ ...diagnostic, location: { ...diagnostic.location } }));
			source.selectedCandidateIndex = source.autoCandidates.length === 1 ? 0 : undefined;
		}
		this.configuredDrafts = this.drafts.map(cloneDraft);
	}

	updateHeader(draftId: string, headerId: string, updates: Partial<Pick<IDesktopRemoteHeaderDraft, 'name' | 'value'>>): void {
		const header = this.drafts.find((source) => source.draftId === draftId)?.headers.find((entry) => entry.id === headerId);
		if (!header) {
			return;
		}
		if (updates.name !== undefined && !header.configured) header.name = updates.name;
		if (updates.value !== undefined) header.value = updates.value;
	}

	removeHeader(draftId: string, headerId: string): void {
		const source = this.drafts.find((entry) => entry.draftId === draftId);
		if (source) {
			source.headers = source.headers.filter((header) => header.id !== headerId);
		}
	}

	validationError(): string {
		if (this.drafts.length === 0) {
			return 'At least one translation source is required.';
		}
		for (const source of this.drafts) {
			const names = new Set<string>();
			for (const header of source.headers) {
				if (!HEADER_NAME_PATTERN.test(header.name)) {
					return `Source "${source.id || 'unnamed'}" contains an invalid HTTP header name.`;
				}
				const normalized = header.name.toLowerCase();
				if (names.has(normalized)) {
					return `Source "${source.id || 'unnamed'}" contains duplicate HTTP header names.`;
				}
				names.add(normalized);
				if (!header.value) {
					return `Enter a temporary value for header "${header.name}".`;
				}
			}
			if (source.type === 'auto-http') {
				if (!this.autoAnalysis) return 'Automatic HTTP loader detection has not completed.';
				if (source.autoCandidates.length === 0) return 'No compatible static HTTP loader candidate was found. Configure an explicit HTTP source instead.';
				if (source.selectedCandidateIndex === undefined) return 'Select one detected HTTP loader candidate before continuing.';
				try {
					resolveAutoHttpCandidate(this.toAutoConfig(source), this.drafts.indexOf(source), source.selectedCandidateIndex, this.autoAnalysis);
				} catch (error) {
					return error instanceof Error ? error.message : 'The selected HTTP loader candidate is incomplete.';
				}
			}
		}
		try {
			parseScannerConfigOverrides({ translationSources: this.toConfigSources() });
			return '';
		} catch (error) {
			return error instanceof Error ? error.message : 'Translation source configuration is invalid.';
		}
	}

	prepareScan(): IPreparedDesktopRemoteScan {
		const validationError = this.validationError();
		if (validationError) {
			throw new Error(validationError);
		}
		const configuredSources = this.toConfigSources();
		const selections = new Map<number, number>();
		this.drafts.forEach((source, index) => {
			if (source.type === 'auto-http' && source.selectedCandidateIndex !== undefined) selections.set(index, source.selectedCandidateIndex);
		});
		const translationSources = this.autoAnalysis
			? expandAutoHttpTranslationSources(configuredSources, this.autoAnalysis, selections).translationSources
			: configuredSources;
		const environment: Record<string, string> = {};
		for (const source of this.drafts) {
			for (const header of source.headers) {
				environment[header.environmentName] = header.value;
			}
		}
		return { translationSources, environment, confirmation: this.buildConfirmation(translationSources) };
	}

	private buildConfirmation(configuredSources: ITranslationSourceConfig[]): IRemoteScanConfirmation {
		const urls = new Set<string>();
		const sources = configuredSources.map((source, index): IRemoteScanConfirmationSource => {
			if (source.type === 'filesystem') {
				return {
					order: index + 1,
					type: 'filesystem',
					id: source.id || `filesystem-${index + 1}`,
					locales: [],
					headerNames: [],
					headerEnvironmentNames: [],
					usesInsecureHttp: false,
					isPrivateOrLocal: false
				};
			}
			if (source.type === 'auto-http') throw new Error('Automatic HTTP source was not resolved before confirmation.');
			const resolved = new URL(source.urlTemplate.replace('{locale}', encodeURIComponent(source.locales[0] ?? 'en')));
			for (const locale of source.locales) {
				urls.add(new URL(source.urlTemplate.replace('{locale}', encodeURIComponent(locale))).toString());
			}
			return {
				order: index + 1,
				type: 'http',
				id: source.id,
				urlTemplate: redactAutoHttpUrlTemplate(source.urlTemplate),
				origin: resolved.origin,
				locales: [...source.locales],
				headerNames: Object.keys(source.headersFromEnv ?? {}),
				headerEnvironmentNames: Object.values(source.headersFromEnv ?? {}),
				usesInsecureHttp: resolved.protocol === 'http:',
				isPrivateOrLocal: isPrivateOrLocalHostname(resolved.hostname)
			};
		});
		return {
			sources,
			expectedRequestCount: urls.size,
			hasInsecureHttp: sources.some((source) => source.usesInsecureHttp),
			hasPrivateOrLocalTarget: sources.some((source) => source.isPrivateOrLocal)
		};
	}

	private toConfigSources(): ITranslationSourceConfig[] {
		return this.drafts.map((source) => {
			if (source.type === 'filesystem') {
				return {
					type: 'filesystem' as const,
					...(source.id.trim() ? { id: source.id.trim() } : {}),
					...(source.includeGlobs.length ? { includeGlobs: source.includeGlobs.map((glob) => glob.trim()).filter(Boolean) } : {})
				};
			}
			if (source.type === 'auto-http') return this.toAutoConfig(source);
			const headersFromEnv = Object.fromEntries(source.headers.map((header) => [header.name.trim(), header.environmentName]));
			return {
				type: 'http' as const,
				id: source.id.trim(),
				urlTemplate: source.urlTemplate.trim(),
				locales: source.locales.map((locale) => locale.trim()).filter(Boolean),
				...(source.headers.length ? { headersFromEnv } : {})
			};
		});
	}

	private toAutoConfig(source: IDesktopTranslationSourceDraft): Extract<ITranslationSourceConfig, { type: 'auto-http' }> {
		const headersFromEnv = Object.fromEntries(source.headers.map((header) => [header.name.trim(), header.environmentName]));
		return {
			type: 'auto-http',
			...(source.id.trim() ? { id: source.id.trim() } : {}),
			...(source.origin.trim() ? { origin: source.origin.trim() } : {}),
			...(source.locales.length ? { locales: source.locales.map((locale) => locale.trim()).filter(Boolean) } : {}),
			...(source.headers.length ? { headersFromEnv } : {})
		};
	}

	private fromConfig(source: ITranslationSourceConfig): IDesktopTranslationSourceDraft {
		const draftId = this.nextId('source');
		if (source.type === 'filesystem') {
			return {
				draftId,
				type: 'filesystem',
				id: source.id ?? '',
				includeGlobs: [...(source.includeGlobs ?? [])],
				urlTemplate: '',
				origin: '',
				locales: [],
				headers: [],
				configured: true,
				autoCandidates: [],
				autoDiagnostics: []
			};
		}
		if (source.type === 'auto-http') {
			return {
				draftId, type: 'auto-http', id: source.id ?? '', includeGlobs: [], urlTemplate: '', origin: source.origin ?? '',
				locales: [...(source.locales ?? [])],
				headers: Object.entries(source.headersFromEnv ?? {}).map(([name, environmentName]) => ({
					id: this.nextId('header'), name, environmentName, value: '', configured: true
				})),
				configured: true, autoCandidates: [], autoDiagnostics: []
			};
		}
		return {
			draftId,
			type: 'http',
			id: source.id,
			includeGlobs: [],
			urlTemplate: source.urlTemplate,
			origin: '',
			locales: [...source.locales],
			headers: Object.entries(source.headersFromEnv ?? {}).map(([name, environmentName]) => ({
				id: this.nextId('header'),
				name,
				environmentName,
				value: '',
				configured: true
			})),
			configured: true,
			autoCandidates: [],
			autoDiagnostics: []
		};
	}

	private nextId(prefix: string): string {
		this.sequence += 1;
		return `${prefix}-${this.sequence}`;
	}
}
