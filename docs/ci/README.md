# Check-i18n in CI/CD

The scan engine that powers the desktop app is published as a headless CLI
(`@check-i18n/cli`). It reads the same adapters, globs and rules, so a pipeline
run produces the same findings as the desktop UI.

## Command

```bash
npx @check-i18n/cli scan . \
  --reporter text \
  --output json=check-i18n-report/check-i18n.json \
  --output markdown=check-i18n-report/check-i18n.md \
  --max-errors 0
```

| Option | Description |
| --- | --- |
| `--config <file>` | Path to a `check-i18n.config.json`. Missing file is an error. |
| `--reporter <name>` | `text`, `json` or `markdown`. Repeatable. Default `text`. |
| `--output <name>=<file>` | Redirect a reporter to a file. Implicitly enables that reporter. |
| `--max-errors <n>` | Tolerated `error` findings (missing keys). Default `0`. |
| `--max-warnings <n>` | Tolerated `warning` findings (unused, dynamic, extra). Default unlimited. |
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
| `unused`, `dynamic-uncertain`, `extra-in-language` | `warning` |
| `used` | `info` (never counted against thresholds) |

## Configuration file

`check-i18n.config.json` in the project root (or a `check-i18n` key in
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
docker build -f docker/Dockerfile -t check-i18n .
docker run --rm -v "$PWD:/work" check-i18n scan . --max-errors 0
```
