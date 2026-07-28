import { AdapterRegistry } from './adapter-registry.js';
import { angularScanAdapter } from './angular/angular-scan.adapter.js';

export const defaultAdapterRegistry = new AdapterRegistry([angularScanAdapter]);
