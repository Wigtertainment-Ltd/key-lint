export type TranslationResourceSourceType = 'filesystem';

export interface ITranslationResourceOrigin {
	type: 'file';
	path: string;
}

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
