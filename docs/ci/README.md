# KeyLint in CI/CD

The scan engine that powers the desktop app is published as a headless CLI
(`@key-lint/cli`). It reads the same adapters, globs and rules, so a pipeline
run produces the same findings as the desktop UI.

## Command

```bash
npx @key-lint/cli scan . \
  --reporter text \
  --output json=keylint-report/keylint.json \
  --output markdown=keylint-report/keylint.md \
  --max-errors 0
```

| Option | Description |
| --- | --- |
| `--config <file>` | Path to a `keylint.config.json`. Missing file is an error. |
| `--reporter <name>` | `text`, `json` or `markdown`. Repeatable. Default `text`. |
| `--output <name>=<file>` | Redirect a reporter to a file. Implicitly enables that reporter. |
| `--max-errors <n>` | Tolerated `error` findings (missing keys). Default `0`. |
| `--max-warnings <n>` | Tolerated `warning` findings (unused, dynamic, indirect, extra). Default unlimited. |
| `--ignore <glob>` | Translation key glob to drop from the result. Repeatable. Replaces `ignoreKeys` from the config file. |
| `--quiet` | No progress output on stderr. |
| `--no-color` | Disable ANSI colors (also honoured via `NO_COLOR`). |

Progress goes to **stderr**, reports go to **stdout**, so `--reporter json` can be
piped safely.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Thresholds respected |
| `1` | Error or warning threshold exceeded |
| `2` | Usage error, invalid config, unreadable project path, no adapter detected |

### Severity mapping

| Finding status | Severity |
| --- | --- |
| `missing-in-language` | `error` |
| `unused`, `dynamic-uncertain`, `indirect-uncertain`, `extra-in-language` | `warning` |
| `used` | `info` (never counted against thresholds) |

## Configuration file

`keylint.config.json` in the project root (or a `keylint` key in
`package.json`). Only JSON is supported - a config file must never execute code.

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

Precedence: built-in defaults < `package.json` < config file < CLI flags.
Arrays are replaced, never merged. Unknown keys fail the run.

## Pipeline examples

- [GitHub Actions](github-actions.yml)
- [GitLab CI](gitlab-ci.yml)
- [Azure DevOps](azure-pipelines.yml)
- [Jenkins](Jenkinsfile)

## Docker

```bash
docker build -f docker/Dockerfile -t keylint .
docker run --rm -v "$PWD:/work" keylint scan . --max-errors 0
```
