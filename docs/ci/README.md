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
| `--allow-network` | Explicitly enable configured remote translation requests. Disabled by default. |
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

`baseLocale` is optional and defines the canonical translation key set. Missing
and extra findings are emitted once per affected locale. Without an explicit
value, KeyLint prefers exact `en`, then the most complete `en-*` locale, then the
most complete locale overall. A configured locale that is not found is an error.

Precedence: built-in defaults < `package.json` < config file < CLI flags.
Arrays are replaced, never merged. Unknown keys fail the run.

The GitHub Action exposes the equivalent `allow-network` input, defaulting to
`false`. For authenticated sources, map header names to environment names in
configuration and GitHub Secrets to those names in the step environment.
Credential values are removed before the Action writes reports or a job summary.
See the [Action reference](../../packages/action/README.md).

## Pipeline examples

- [GitHub Actions](github-actions.yml)
- [GitLab CI](gitlab-ci.yml)
- [Azure DevOps](azure-pipelines.yml)
- [Jenkins](Jenkinsfile)

### Publishing the report with GitHub Pages

The [GitHub Actions example](github-actions.yml) uploads the complete report
directory as a normal CI artifact on every run. Pull requests therefore expose a
downloadable report without being allowed to replace the stable public site.

On a push to the repository's default branch, the workflow additionally passes
the Action's `site-directory` output to the official
`actions/configure-pages`, `actions/upload-pages-artifact` and
`actions/deploy-pages` flow. The deployment runs in the `github-pages`
environment and exposes its URL through `steps.deployment.outputs.page_url`.

The deploy job requires these permissions:

```yaml
permissions:
  pages: write
  id-token: write
```

In the repository settings, select **GitHub Actions** as the Pages publishing
source. Configure the `github-pages` environment with a deployment protection
rule for the default branch if the environment does not already enforce it. The
workflow also checks the branch itself and verifies that `index.html` exists
before creating the Pages artifact. Consequently, successful scans and threshold
failures with exit code `1` can publish a report, while a runtime failure without
HTML output skips the deployment.

## Docker

```bash
docker build -f docker/Dockerfile -t keylint .
docker run --rm -v "$PWD:/work" keylint scan . --max-errors 0
```
