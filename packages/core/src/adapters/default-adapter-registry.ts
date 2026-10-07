import { AdapterRegistry } from './adapter-registry.js';
import { angularScanAdapter } from './angular/angular-scan.adapter.js';

/** Shared default registry initialized with the Angular scanner; callers may register additional adapters. */
export const defaultAdapterRegistry = new AdapterRegistry([angularScanAdapter]);
