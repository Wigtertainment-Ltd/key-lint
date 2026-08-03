import { IAdapterDetectionResult, IScanAdapter } from "./scan-adapter.interface.js";

export interface IPatternDescriptor {
	matchType: string;
	regex: RegExp;
	dynamic: boolean;
	keyCaptureIndex?: number;
	literalKeyExtraction?: boolean;
}

export interface IAdapterMatch {
	adapter: IScanAdapter;
	detection: IAdapterDetectionResult;
}
