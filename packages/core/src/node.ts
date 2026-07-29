/**
 * Node-only entry point (`@key-lint/core/node`).
 * Kept separate from the main entry so browser/Electron renderer bundles never
 * pull in `node:fs`.
 */
export * from './fs/node-file-system.adapter.js';
export * from './config/load-config.js';
