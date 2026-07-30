# @key-lint/core

Framework-agnostic i18n scan engine. Detects missing, unused and dynamically resolved translation keys in frontend projects — the same engine that powers the [KeyLint](https://github.com/Wigtertainment-Ltd/key-lint) desktop app and CLI.

## Features

- **Adapter registry** with built-in Angular / ngx-translate support
- **Configurable guardrails** (max files, max file size) to keep scans fast
- **`ignoreKeys`** glob patterns to suppress known false positives
- **Progress callbacks** for live UI updates or CI logging
- **Node-only APIs** (`@key-lint/core/node`) for CLI and pipeline usage

## Installation

```bash
npm install @key-lint/core --save-dev
```

Requires Node ≥ 20.

## Usage (browser / Angular)

```ts
import { runScan, defaultAdapterRegistry } from '@key-lint/core';

const result = await runScan({
  projectRoot: '/path/to/project',
  registry: defaultAdapterRegistry,
});

console.log(result.summary.totalFindings); // → 37
```

## Usage (Node / CLI)

The Node subpath export exposes `NodeFileSystemAdapter` and config loading:

```ts
import { runScan } from '@key-lint/core';
import { NodeFileSystemAdapter, loadScannerConfig } from '@key-lint/core/node';

const config = await loadScannerConfig({ projectRoot: '.' });
const fs = new NodeFileSystemAdapter(config.guardrails);

const result = await runScan({
  projectRoot: '.',
  fs,
  config,
});
```

## Subpath exports

| Export | Purpose |
| --- | --- |
| `@key-lint/core` | Browser-safe engine (adapter registry, scan, models) |
| `@key-lint/core/node` | Node-only APIs (`NodeFileSystemAdapter`, `loadScannerConfig`) |

## License

MIT © Wigtertainment Ltd
