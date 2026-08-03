import { IAdapterMatch } from './adapter.interfaces.js';
import { IFileSystemAdapter, IScanAdapter } from './scan-adapter.interface.js';

export class AdapterRegistry {
	private readonly adapters: IScanAdapter[] = [];

	constructor(initialAdapters: IScanAdapter[] = []) {
		for (const adapter of initialAdapters) {
			this.register(adapter);
		}
	}

	register(adapter: IScanAdapter): void {
		if (this.adapters.some((item) => item.id === adapter.id)) {
			return;
		}

		this.adapters.push(adapter);
	}

	list(): IScanAdapter[] {
		return [...this.adapters];
	}

	async detectBestAdapter(projectRoot: string, fs: IFileSystemAdapter): Promise<IAdapterMatch | null> {
		let bestMatch: IAdapterMatch | null = null;

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
