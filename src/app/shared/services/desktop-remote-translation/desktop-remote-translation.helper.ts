import { IDesktopTranslationSourceDraft, IDesktopRemoteHeaderDraft, IDesktopAutoHttpCandidate } from './desktop-remote-translation.interfaces';
import type { ILoaderDetectionDiagnostic } from '@key-lint/core/detection';

export function cloneDraft(source: IDesktopTranslationSourceDraft): IDesktopTranslationSourceDraft {
	return {
		...source,
		includeGlobs: [...source.includeGlobs],
		locales: [...source.locales],
		headers: source.headers.map((header: IDesktopRemoteHeaderDraft): IDesktopRemoteHeaderDraft => ({ ...header })),
		autoCandidates: source.autoCandidates.map((candidate: IDesktopAutoHttpCandidate): IDesktopAutoHttpCandidate => ({
			...candidate,
			urlTemplates: [...candidate.urlTemplates],
			locales: [...candidate.locales]
		})),
		autoDiagnostics: source.autoDiagnostics.map((diagnostic: ILoaderDetectionDiagnostic): ILoaderDetectionDiagnostic => ({ ...diagnostic, location: { ...diagnostic.location } }))
	};
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
	const normalized: string = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
		return true;
	}
	if (normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) {
		return true;
	}
	const parts: number[] = normalized.split('.').map(Number);
	if (parts.length !== 4 || parts.some((part: number): boolean => !Number.isInteger(part) || part < 0 || part > 255)) {
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
