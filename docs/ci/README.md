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
  --output html=keylint-report/site/index.html \
  --max-errors 0
```

| Option | Description |
| --- | --- |
| `--config <file>` | Path to a `keylint.config.json`. Missing file is an error. |
| `--reporter <name>` | `text`, `json`, `markdown` or `html`. Repeatable. Default `text`. |
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

The HTML report follows a deliberately restricted privacy model: it omits
absolute project roots, translation values, and source snippets, and it retains
the shared credential-redaction pass used by all reporters. Relative evidence
locations remain available for remediation. Hosting credentials belong to the
CI or hosting provider and must never be supplied to KeyLint.

## Pipeline examples

- [GitHub Actions](github-actions.yml)
- [GitLab CI](gitlab-ci.yml)
- [Azure DevOps](azure-pipelines.yml)
- [Jenkins](Jenkinsfile)

The GitLab, Azure DevOps, and Jenkins templates generate
`keylint-report/site/index.html` and retain it through their respective
always-run artifact mechanisms. Because the CLI writes requested reports before
returning exit code `1`, threshold failures still produce a downloadable HTML
site. Runtime failures may produce no HTML; provider publication must therefore
check for `site/index.html` rather than relying on the scan exit status alone.

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

### Publishing to Amazon S3

The [S3 publication script](publish-s3.sh) uploads only the self-contained public
`site/index.html`; JSON and Markdown never leave the private CI artifact. It sets
an explicit `text/html` content type and a revalidation-oriented cache policy so
the stable report URL updates promptly. It intentionally does not use a public
object ACL. Configure access at the bucket, CloudFront, or another protected
delivery layer instead.

A complete default-branch example using GitHub OIDC is available in
[github-actions-s3.yml](github-actions-s3.yml). It uses repository variables for
the role ARN, AWS region, and bucket name; no long-lived AWS access key is stored
in the workflow.

Authenticate the AWS CLI through the CI platform's native identity mechanism.
For example, GitHub Actions and GitLab CI can exchange their OIDC identity for a
short-lived, least-privilege AWS role; AWS-hosted build services should use their
assigned role. Do not pass AWS credentials to KeyLint.

Run the script after the scan with the site directory and destination URI:

```bash
KEYLINT_SITE_DIRECTORY=keylint-report/site \
KEYLINT_S3_URI=s3://example-report-bucket/keylint \
sh ./docs/ci/publish-s3.sh
```

The script exits successfully without contacting AWS when `index.html` is
missing. CI systems can therefore invoke it from an `always`/post step: exit code
`1` publishes the generated report, while exit code `2` without HTML does not.

### Publishing to Netlify

Install `netlify-cli` as a pinned development dependency so the existing lock
file controls the CI version. Store `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` in
the CI provider's protected secret store; they are consumed by Netlify CLI and
are never passed to KeyLint.

The complete [Netlify workflow](github-actions-netlify.yml) creates previews for
pull requests and reserves production publication for the default branch. CI
providers do not expose protected secrets to every pull request, so untrusted
forks should rely on the ordinary downloadable report artifact instead.

Create a unique preview deployment for pull requests or temporary branches:

```bash
KEYLINT_SITE_DIRECTORY=keylint-report/site \
KEYLINT_NETLIFY_DEPLOY_MODE=preview \
sh ./docs/ci/publish-netlify.sh
```

Production publication is a separate, explicit operation and should be guarded
to the default branch in the surrounding pipeline:

```bash
KEYLINT_SITE_DIRECTORY=keylint-report/site \
KEYLINT_NETLIFY_DEPLOY_MODE=production \
sh ./docs/ci/publish-netlify.sh
```

Production mode adds Netlify's `--prod` flag; preview mode deliberately omits it.
Both modes skip deployment when `site/index.html` is absent and upload only the
public site directory.

### Other static hosts

`keylint-report/site` is provider-neutral and can be copied to any static host.
KeyLint neither receives nor processes hosting credentials. Public hosting is an
explicit choice: reports intended only for employees or customers should be
published behind the organization's existing access controls.

## Docker

```bash
docker build -f docker/Dockerfile -t keylint .
docker run --rm -v "$PWD:/work" keylint scan . --max-errors 0
```
