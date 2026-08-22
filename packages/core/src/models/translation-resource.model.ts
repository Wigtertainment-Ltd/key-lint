export type TranslationResourceSourceType = 'filesystem' | 'http';

export interface IFileTranslationResourceOrigin {
	type: 'file';
	path: string;
}

export interface IHttpTranslationResourceOrigin {
	type: 'http';
	url: string;
}

export type ITranslationResourceOrigin =
	| IFileTranslationResourceOrigin
	| IHttpTranslationResourceOrigin;

/**
 * Source-neutral translation input used by resource-aware scan adapters.
 * Content is parsed once while origin and position metadata remain available
 * for reporting and later write-safety decisions.
 */
export interface ITranslationResource {
	locale: string;
	sourceType: TranslationResourceSourceType;
	sourceId: string;
	sourceIndex: number;
	resourceIndex: number;
	position: number;
	content: Record<string, unknown>;
	origin: ITranslationResourceOrigin;
	writable: boolean;
}
