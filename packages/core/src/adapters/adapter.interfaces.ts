import { IAdapterDetectionResult, IScanAdapter } from "./scan-adapter.interface.js";

export interface IPatternDescriptor {
	matchType: string;
	/** Explains the source construct recognized by the regular expression. */
	description: string;
	/** Representative source snippets that must be matched by the regular expression. */
	examples: readonly string[];
	regex: RegExp;
	dynamic: boolean;
	keyCaptureIndex?: number;
	literalKeyExtraction?: boolean;
}

export interface IAdapterMatch {
	adapter: IScanAdapter;
	detection: IAdapterDetectionResult;
}
