import { Injectable } from '@angular/core';
import {
	ITranslationSourceConfig,
	parseScannerConfigOverrides
} from '@key-lint/core';

export interface IDesktopRemoteHeaderDraft {
	id: string;
	name: string;
	environmentName: string;
	value: string;
	configured: boolean;
}

export interface IDesktopTranslationSourceDraft {
	draftId: string;
	type: 'filesystem' | 'http';
	id: string;
	includeGlobs: string[];
	urlTemplate: string;
	locales: string[];
	headers: IDesktopRemoteHeaderDraft[];
	configured: boolean;
}

export interface IRemoteScanConfirmationSource {
	order: number;
	type: 'filesystem' | 'http';
	id: string;
	urlTemplate?: string;
	origin?: string;
	locales: string[];
	headerNames: string[];
	headerEnvironmentNames: string[];
	usesInsecureHttp: boolean;
	isPrivateOrLocal: boolean;
}

export interface IRemoteScanConfirmation {
	sources: IRemoteScanConfirmationSource[];
	expectedRequestCount: number;
	hasInsecureHttp: boolean;
	hasPrivateOrLocalTarget: boolean;
}

export interface IPreparedDesktopRemoteScan {
	translationSources: ITranslationSourceConfig[];
	environment: Record<string, string>;
	confirmation: IRemoteScanConfirmation;
}

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function cloneDraft(source: IDesktopTranslationSourceDraft): IDesktopTranslationSourceDraft {
	return {
		...source,
		includeGlobs: [...source.includeGlobs],
		locales: [...source.locales],
		headers: source.headers.map((header) => ({ ...header }))
	};
}

function isPrivateOrLocalHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
		return true;
	}
	if (normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) {
		return true;
	}
	const parts = normalized.split('.').map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
		return false;
	}
	return parts[0] === 10 ||
		parts[0] === 0 ||
		parts[0] === 127 ||
		(parts[0] === 100 && (parts[1] ?? 0) >= 64 && (parts[1] ?? 0) <= 127) ||
		(parts[0] === 169 && parts[1] === 254) ||
		(parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
		(parts[0] === 192 && parts[1] === 168);
}

@Injectable({ providedIn: 'root' })
export class DesktopRemoteTranslationService {
	private drafts: IDesktopTranslationSourceDraft[] = [];
	private configuredDrafts: IDesktopTranslationSourceDraft[] = [];
	private sequence = 0;

	get sources(): IDesktopTranslationSourceDraft[] {
		return this.drafts.map(cloneDraft);
	}

	get hasRemoteSources(): boolean {
		return this.drafts.some((source) => source.type === 'http');
	}

	loadConfiguredSources(sources: ITranslationSourceConfig[] = [{ type: 'filesystem' }]): void {
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
			locales: [],
			headers: [],
			configured: false
		});
	}

	addHttpSource(): void {
		this.drafts.push({
			draftId: this.nextId('source'),
			type: 'http',
			id: '',
			includeGlobs: [],
			urlTemplate: '',
			locales: [],
			headers: [],
			configured: false
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

	updateSource(draftId: string, updates: Partial<Pick<IDesktopTranslationSourceDraft, 'id' | 'includeGlobs' | 'urlTemplate' | 'locales'>>): void {
		const source = this.drafts.find((entry) => entry.draftId === draftId);
		if (!source) {
			return;
		}
		if (updates.id !== undefined) source.id = updates.id;
		if (updates.includeGlobs !== undefined) source.includeGlobs = [...updates.includeGlobs];
		if (updates.urlTemplate !== undefined) source.urlTemplate = updates.urlTemplate;
		if (updates.locales !== undefined) source.locales = [...updates.locales];
	}

	addTemporaryHeader(draftId: string): void {
		const source = this.drafts.find((entry) => entry.draftId === draftId && entry.type === 'http');
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
		const translationSources = this.toConfigSources();
		const environment: Record<string, string> = {};
		for (const source of this.drafts) {
			for (const header of source.headers) {
				environment[header.environmentName] = header.value;
			}
		}
		return { translationSources, environment, confirmation: this.buildConfirmation() };
	}

	private buildConfirmation(): IRemoteScanConfirmation {
		const urls = new Set<string>();
		const sources = this.drafts.map((source, index): IRemoteScanConfirmationSource => {
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
			const resolved = new URL(source.urlTemplate.replace('{locale}', encodeURIComponent(source.locales[0] ?? 'en')));
			for (const locale of source.locales) {
				urls.add(new URL(source.urlTemplate.replace('{locale}', encodeURIComponent(locale))).toString());
			}
			return {
				order: index + 1,
				type: 'http',
				id: source.id,
				urlTemplate: source.urlTemplate,
				origin: resolved.origin,
				locales: [...source.locales],
				headerNames: source.headers.map((header) => header.name),
				headerEnvironmentNames: source.headers.map((header) => header.environmentName),
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

	private fromConfig(source: ITranslationSourceConfig): IDesktopTranslationSourceDraft {
		const draftId = this.nextId('source');
		if (source.type === 'filesystem') {
			return {
				draftId,
				type: 'filesystem',
				id: source.id ?? '',
				includeGlobs: [...(source.includeGlobs ?? [])],
				urlTemplate: '',
				locales: [],
				headers: [],
				configured: true
			};
		}
		return {
			draftId,
			type: 'http',
			id: source.id,
			includeGlobs: [],
			urlTemplate: source.urlTemplate,
			locales: [...source.locales],
			headers: Object.entries(source.headersFromEnv ?? {}).map(([name, environmentName]) => ({
				id: this.nextId('header'),
				name,
				environmentName,
				value: '',
				configured: true
			})),
			configured: true
		};
	}

	private nextId(prefix: string): string {
		this.sequence += 1;
		return `${prefix}-${this.sequence}`;
	}
}
