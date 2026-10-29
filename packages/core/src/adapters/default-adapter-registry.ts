import { AdapterRegistry } from './adapter-registry.js';
import { angularScanAdapter } from './angular/angular-scan.adapter.js';
import { reactScanAdapter } from './react/react-scan.adapter.js';

/** Shared default registry initialized with Angular and React scanners; callers may register additional adapters. */
export const defaultAdapterRegistry = new AdapterRegistry([angularScanAdapter, reactScanAdapter]);
