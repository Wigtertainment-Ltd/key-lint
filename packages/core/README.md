# @key-lint/core

Framework-agnostic i18n scan engine. Detects missing, unused and dynamically resolved translation keys in frontend projects — the same engine that powers the [KeyLint](https://github.com/Wigtertainment-Ltd/key-lint) desktop app and CLI.

## Features

- **Adapter registry** with built-in Angular / ngx-translate support
- **Configurable guardrails** (max files, max file size) to keep scans fast
- **`ignoreKeys`** glob patterns to suppress known false positives
- **Progress callbacks** for live UI updates or CI logging
- **Per-locale consistency checks** with configurable or automatic base locale selection
- **Mustache placeholder contracts** across locales and Angular usage sites
- **Fail-fast translation validation** with file-specific errors for unreadable JSON, malformed JSON and non-object roots
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

Set `config.baseLocale` to make one locale canonical. When omitted, the engine
prefers exact `en`, then the most complete English variant, then the most complete
discovered locale. Missing and extra findings carry the affected `language`.

For JSON translations, `{{name}}` placeholders in the base locale form a contract.
The Angular adapter validates parameters supplied to translation service methods,
ngx-translate/Transloco pipes, ngx-translate directives and Transloco structural
calls. Definite omissions and locale placeholder mismatches are errors. Dynamic
parameter expressions produce `placeholder-uncertain` warnings; extra parameters
are accepted. Matrix rows expose placeholder names through `placeholders[locale]`.

Every discovered translation file must be readable, contain valid JSON and use
an object as its root value. A violation rejects `runScan` with a
`TranslationFileError`; no partial result is returned.

## Translation resources

The scanner represents translation inputs as ordered `ITranslationResource`
objects. Each resource retains its locale, source identifier, deterministic
position, parsed content, origin and writability. Existing configurations are
equivalent to one implicit filesystem source:

```json
{
  "translationSources": [{ "type": "filesystem" }]
}
```

Multiple filesystem sources are evaluated in configuration order. Plain JSON
objects merge recursively; later arrays, primitive values, `null` values and
type conflicts replace the earlier value. A filesystem source can provide
`includeGlobs`; otherwise the existing global translation globs control which
files it discovers.

Filesystem adapters can expose structured `IFileSystemWarning` values for
oversized files, file-count limits, unreadable directories and skipped symbolic
links. The Node CLI and Electron desktop adapters enforce the same configured
guardrail values.

### HTTP translation sources (experimental)

An HTTP source declares the locales to fetch and an absolute HTTP(S) URL with
exactly one `{locale}` placeholder:

```json
{
  "translationSources": [
    {
      "type": "http",
      "id": "feature-api",
      "urlTemplate": "https://api.example.com/i18n/{locale}.json",
      "locales": ["de", "en"],
      "headersFromEnv": {
        "Authorization": "KEYLINT_TRANSLATION_AUTH"
      }
    }
  ]
}
```

Header values cannot be stored in configuration. `headersFromEnv` maps header
names to environment-variable names, and every referenced variable must exist
at scan time. Core performs no network I/O itself: callers must explicitly set
`allowNetwork` and inject an `IRemoteTranslationFetcher`. Remote resources are
marked read-only, and later sources still override earlier sources recursively.

The Node transport exported from `@key-lint/core/node` uses GET, a 15-second
total timeout, at most three redirects, the configured file-size limit and at
most 100 distinct URLs per scan. Sensitive headers are removed on cross-origin
redirects, duplicate URLs are fetched once, and query values are redacted from
diagnostics.

`resolveScannerConfigSources` also returns `guardrailSources`, identifying the
winning source (`default`, `package-json`, `config-file` or `override`) for each
effective guardrail.

## Usage (Node / CLI)

The Node subpath export exposes `NodeFileSystemAdapter` and config loading:

```ts
import { runScan } from '@key-lint/core';
import {
  NodeFileSystemAdapter,
  NodeRemoteTranslationFetcher,
  loadScannerConfig
} from '@key-lint/core/node';

const config = await loadScannerConfig({ projectRoot: '.' });
const fs = new NodeFileSystemAdapter(config.guardrails);

const result = await runScan({
  projectRoot: '.',
  fs,
  config,
  remoteTranslations: {
    allowNetwork: true,
    fetcher: new NodeRemoteTranslationFetcher(),
    environment: process.env
  }
});
```

## Subpath exports

| Export | Purpose |
| --- | --- |
| `@key-lint/core` | Browser-safe engine (adapter registry, scan, models) |
| `@key-lint/core/node` | Node-only APIs (`NodeFileSystemAdapter`, `NodeRemoteTranslationFetcher`, `loadScannerConfig`) |

## License

MIT © Wigtertainment Ltd
