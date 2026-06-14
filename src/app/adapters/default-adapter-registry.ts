import { AdapterRegistry } from '../core/adapters/adapter-registry';
import { angularScanAdapter } from './angular/angular-scan.adapter';

export const defaultAdapterRegistry = new AdapterRegistry([angularScanAdapter]);
