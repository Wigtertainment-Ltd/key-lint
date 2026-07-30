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
| `--max-errors <n>` | Tolerated `error` findings (missing keys). Default `0`. |
| `--max-warnings <n>` | Tolerated `warning` findings (unused, dynamic, extra). Default unlimited (`-1`). |
| `--ignore <glob>` | Translation key glob to drop from the result. Repeatable. Overrides config file `ignoreKeys`. |
| `--quiet` | Suppress progress output on stderr. |
| `--no-color` | Disable ANSI colors (also honoured via `NO_COLOR`). |

Progress goes to **stderr**, reports go to **stdout** — so JSON output can be piped safely into CI tools.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Thresholds respected, no errors or warnings exceeded |
| `1` | Error or warning threshold exceeded |
| `2` | Usage error: invalid arguments, missing project path, unreadable config, no adapter detected |

### Severity mapping

| Finding status | Severity |
| --- | --- |
| `missing-in-language` | `error` |
| `unused`, `dynamic-uncertain`, `extra-in-language` | `warning` |
| `used` | `info` (never counted against thresholds) |

## Configuration file

Place a `keylint.config.json` in your project root:

```json
{
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

Alternatively embed the config in `package.json` under the `"keylint"` key.

## Reporters

### JSON reporter

Outputs a structured report with schema version, adapter ID, severity counts, findings and metadata:

```json
{
  "schemaVersion": 1,
  "adapterId": "angular",
  "summary": { "totalFindings": 37 },
  "severityCounts": { "error": 7, "warning": 30 },
  "findings": [ ... ]
}
```

### Markdown reporter

Human-readable table with metric summary, error/warning tables and scan warnings. Ideal for CI artifacts or GitHub Actions step summaries.

## Docker

A pre-built image is available on GHCR:

```bash
docker pull ghcr.io/wigtertainment/key-lint:latest
docker run --rm -v $(pwd):/work -w /work ghcr.io/wigterainment/key-lint scan .
```

## License

MIT © Wigtertainment Ltd
