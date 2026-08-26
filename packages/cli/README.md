# @key-lint/cli

Headless CLI for running KeyLint i18n scans in CI/CD pipelines. Produces the same findings as the [KeyLint](https://github.com/Wigtertainment-Ltd/key-lint) desktop app — no Electron or browser required.

## Installation

```bash
npm install -g @key-lint/cli
# or via npx:
npx @key-lint/cli scan .
```

Requires Node ≥ 20.

## Command

```bash
keylint scan /path/to/project \
  --reporter text \
  --output json=keylint-report/keylint.json \
  --output markdown=keylint-report/keylint.md \
  --max-errors 0
```

### Options

| Option | Description |
| --- | --- |
| `--config <file>` | Path to a `keylint.config.json`. Missing file is an error. |
| `--reporter <name>` | `text`, `json` or `markdown`. Repeatable. Default `text`. |
| `--output <name>=<file>` | Redirect a reporter to a file. Implicitly enables that reporter. |
| `--max-errors <n>` | Tolerated `error` findings (missing keys and placeholder contracts). Default `0`. |
| `--max-warnings <n>` | Tolerated `warning` findings (unused, dynamic, indirect, extra). Default unlimited (`-1`). |
| `--ignore <glob>` | Translation key glob to drop from the result. Repeatable. Overrides config file `ignoreKeys`. |
| `--allow-network` | Explicitly allow requests for configured HTTP translation sources. Disabled by default. |
| `--quiet` | Suppress progress output on stderr. |
| `--no-color` | Disable ANSI colors (also honoured via `NO_COLOR`). |

Progress goes to **stderr**, reports go to **stdout** — so JSON output can be piped safely into CI tools.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Thresholds respected, no errors or warnings exceeded |
| `1` | Error or warning threshold exceeded |
| `2` | Usage/runtime error: invalid arguments, missing project path, unreadable config or translation file, invalid translation JSON, no adapter detected |

### Severity mapping

| Finding status | Severity |
| --- | --- |
| `missing-in-language` | `error` |
| `placeholder-missing`, `placeholder-mismatch` | `error` |
| `placeholder-uncertain` | `warning` |
| `unused`, `dynamic-uncertain`, `indirect-uncertain`, `extra-in-language` | `warning` |
| `used` | `info` (never counted against thresholds) |

## Configuration file

Place a `keylint.config.json` in your project root:

```json
{
  "baseLocale": "en",
  "includeTranslationGlobs": ["src/assets/i18n/**/*.json"],
  "includeSourceGlobs": ["**/*.html", "**/*.ts"],
  "excludeGlobs": ["**/node_modules/**", "**/dist/**"],
  "ignoreKeys": ["LEGACY.**", "VENDOR.*"],
  "guardrails": {
    "maxFiles": 25000,
    "maxFileSizeBytes": 2097152
  }
}
```

`baseLocale` defines the canonical key set for locale consistency checks. Keys
missing from a target locale are errors; keys found only outside the base locale
are warnings. Findings are reported per key and locale. If omitted, KeyLint
prefers exact `en`, then the most complete `en-*` locale, then the most complete
locale overall. A configured locale that is not discovered fails the scan.

Translation files must be readable JSON objects. Malformed JSON, an array or
another non-object root stops the scan with exit code `2`, prints the affected
path to stderr and does not emit a partial report.

Alternatively embed the config in `package.json` under the `"keylint"` key.

### Remote translations

HTTP translation sources remain disabled unless the scan includes
`--allow-network`. Configure only environment-variable names—not credentials—in
`keylint.config.json`:

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

Then provide the value through the process environment and opt in:

```bash
KEYLINT_TRANSLATION_AUTH="Bearer ..." keylint scan . --allow-network
```

A missing environment variable, request failure, invalid response, timeout or
guardrail violation stops the scan with exit code `2` and no partial report.
Remote translations are read-only. Requests use GET, a 15-second total timeout,
at most three redirects, at most 100 distinct URLs per scan and the configured
`maxFileSizeBytes`; duplicate requests are reused and query values are redacted
from errors. Plain HTTP and private/local endpoints are higher-risk targets.

Use `{ "type": "auto-http", "origin": "https://app.example" }` to statically
detect one ngx-translate or Transloco HTTP loader. `origin` is required only for
relative detected URLs; `locales` may override static loader locales. Zero or
multiple candidates, dynamic expressions, interceptors and unsupported patterns
stop before networking and require an explicit `http` source. Later configured
sources recursively override earlier ones; arrays, primitives, `null` and type
conflicts replace earlier values.

## Reporters

### JSON reporter

Outputs a structured report with schema version, adapter ID, severity counts, findings and metadata:

```json
{
  "schemaVersion": 2,
  "adapterId": "angular",
  "summary": { "totalFindings": 37 },
  "severityCounts": { "error": 7, "warning": 30 },
  "findings": [ ... ]
}
```

Schema version 2 adds placeholder summary counters and structured
`placeholderDetails` on placeholder findings. Mustache placeholders are checked
automatically; `ignoreKeys` suppresses their findings in the same way as other
key-specific findings.

Remote integration adds only backward-compatible metadata keys for source and
request counts, detected loader types and read-only state. Every reporter is
post-processed to remove configured authentication environment values.

### Markdown reporter

Human-readable table with metric summary, error/warning tables and scan warnings. Ideal for CI artifacts or GitHub Actions step summaries.

## Docker

A pre-built image is available on GHCR:

```bash
docker pull ghcr.io/wigtertainment/key-lint:latest
docker run --rm -v $(pwd):/work -w /work ghcr.io/wigtertainment/key-lint scan .
```

## License

MIT © Wigtertainment Ltd
