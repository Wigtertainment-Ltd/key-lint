import { AdapterDetectionResult, FileSystemAdapter, ScanAdapter } from './scan-adapter.interface';

export interface AdapterMatch {
	adapter: ScanAdapter;
	detection: AdapterDetectionResult;
}

export class AdapterRegistry {
	private readonly adapters: ScanAdapter[] = [];

	constructor(initialAdapters: ScanAdapter[] = []) {
		for (const adapter of initialAdapters) {
			this.register(adapter);
		}
	}

	register(adapter: ScanAdapter): void {
		if (this.adapters.some((item) => item.id === adapter.id)) {
			return;
		}

		this.adapters.push(adapter);
	}

	list(): ScanAdapter[] {
		return [...this.adapters];
	}

	async detectBestAdapter(projectRoot: string, fs: FileSystemAdapter): Promise<AdapterMatch | null> {
		let bestMatch: AdapterMatch | null = null;

		for (const adapter of this.adapters) {
			const result = await adapter.detect(projectRoot, fs);
			if (!result.supported) {
				continue;
			}

			if (!bestMatch || result.confidence > bestMatch.detection.confidence) {
				bestMatch = { adapter, detection: result };
			}
		}

		return bestMatch;
	}
}
