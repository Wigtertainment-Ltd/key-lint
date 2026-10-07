import { IAdapterMatch } from './adapter.interfaces.js';
import { IFileSystemAdapter, IScanAdapter } from './scan-adapter.interface.js';

export class AdapterRegistry {
	private readonly adapters: IScanAdapter[] = [];

	/**
	 * Creates a registry and registers initial adapters in the supplied order.
	 *
	 * @param initialAdapters - Optional adapter instances; duplicate IDs retain the first instance.
	 */
	constructor(initialAdapters: IScanAdapter[] = []) {
		for (const adapter of initialAdapters) {
			this.register(adapter);
		}
	}

	/**
	 * Appends an adapter unless its ID is already registered.
	 *
	 * @param adapter - Adapter instance to retain; existing registrations are not replaced.
	 */
	register(adapter: IScanAdapter): void {
		if (this.adapters.some((item) => item.id === adapter.id)) {
			return;
		}

		this.adapters.push(adapter);
	}

	/**
	 * Returns registered adapters without exposing the registry's internal array.
	 *
	 * @returns A shallow copy in registration order, sharing the adapter instances.
	 */
	list(): IScanAdapter[] {
		return [...this.adapters];
	}

	/**
	 * Runs every registered detector sequentially and selects the supported result with highest confidence.
	 * Equal confidence retains the earlier registration; an unsupported result is ignored.
	 *
	 * @param projectRoot - Project directory passed unchanged to each detector.
	 * @param fs - Filesystem implementation available to the detectors.
	 * @returns The best adapter and its detection result, or `null` when none supports the project.
	 * @throws {Error} When an adapter detector rejects; remaining detectors are not run.
	 */
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
