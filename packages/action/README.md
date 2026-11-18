# KeyLint GitHub Action

The composite Action runs `@key-lint/cli`, writes JSON and Markdown reports,
generates a directly publishable HTML site and optionally appends the Markdown
report to the job summary. Remote translation requests are disabled by default
and cannot be enabled by project configuration.

The CLI supports the `text`, `json`, `markdown` and `html` reporters. The Action
generates the three file-based formats—JSON, Markdown, and HTML—in one scan.

```yaml
- uses: Wigtertainment-Ltd/key-lint/packages/action@v1
  env:
    KEYLINT_TRANSLATION_AUTH: ${{ secrets.KEYLINT_TRANSLATION_AUTH }}
    KEYLINT_TRANSLATION_API_KEY: ${{ secrets.KEYLINT_TRANSLATION_API_KEY }}
  with:
    path: .
    allow-network: 'true'
    max-errors: '0'
```

By default, the Action creates:

```text
keylint-report/
├── keylint.json
├── keylint.md
└── site/
    └── index.html
```

`json-report` and `markdown-report` point to the machine-readable reports outside
the public site. `html-report` points to `site/index.html`, while
`site-directory` points to the directory that can be passed directly to a static
hosting or artifact action:

```yaml
- id: keylint
  uses: Wigtertainment-Ltd/key-lint/packages/action@v1

- if: always() && hashFiles('keylint-report/site/index.html') != ''
  uses: actions/upload-artifact@v4
  with:
    name: keylint-site
    path: ${{ steps.keylint.outputs.site-directory }}
```

The CLI writes all requested reports before returning a threshold failure. This
means `site/index.html` remains available when the Action exits with code `1`.
A runtime or configuration failure with exit code `2` may not produce reports.
For a complete default-branch-only deployment using GitHub Pages, see the
[GitHub Actions example](../../docs/ci/github-actions.yml) and its
[setup notes](../../docs/ci/README.md#publishing-the-report-with-github-pages).

The publishable HTML omits absolute project roots, translation values, and
source snippets. Configured credential values remain covered by the CLI's shared
reporter redaction. Hosting tokens, cloud roles, and deployment credentials are
owned by the surrounding CI workflow and are never inputs to the KeyLint Action.

Configuration contains environment-variable names, never values:

```json
{
  "translationSources": [{
    "type": "http",
    "id": "translations",
    "urlTemplate": "https://api.example.com/i18n/{locale}.json",
    "locales": ["en", "de"],
    "headersFromEnv": {
      "Authorization": "KEYLINT_TRANSLATION_AUTH",
      "X-API-Key": "KEYLINT_TRANSLATION_API_KEY"
    }
  }]
}
```

`allow-network` accepts only `true` or `false` and defaults to `false`. The Action
forwards `--allow-network` only for the literal value `true`. Missing secret
variables fail before any request. CLI redaction applies before reports, artifacts
or summaries are written. Avoid printing secrets in surrounding workflow steps.

All inputs and outputs are defined in [`action.yml`](action.yml). Automatic
sources use `type: "auto-http"` and follow the same opt-in and secret mapping.

## Pull request comments

Set `pr-comment: 'true'` to create one KeyLint summary comment per pull request.
Later runs update that comment with the result, error and warning counts, and a
link to the workflow run containing the full report. Comments are disabled by
default and use the built-in workflow token; no additional secret is needed.
The Action forwards the CLI's `--pr-comment` flag; GitHub and GitLab use the
same packaged implementation. No helper scripts need to be copied into the
scanned project. When pinning `version`, select a CLI release with this option.

```yaml
permissions:
  contents: read
  pull-requests: write

concurrency:
  group: keylint-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

Enable the option on the Action step:

```yaml
- uses: Wigtertainment-Ltd/key-lint/packages/action@v1
  with:
    pr-comment: 'true'
```

Keep the report upload step with `if: always()` as shown in the
[complete workflow](../../docs/ci/github-actions.yml). The comment links to that
specific run, so no public HTML hosting is required. Only the status and numeric
counts are posted; findings remain in the existing reports.

Use one commenting workflow per pull request and the concurrency group above to
avoid simultaneous comment creation or updates. Older commits and older runs or
attempts of the same workflow do not overwrite a newer result. Only comments
with the KeyLint marker authored by `github-actions[bot]` are updated.

Comments run after successful scans and threshold failures (exit codes `0` and
`1`), preserving a threshold failure's exit code. Runtime scan failures, push
events and fork pull requests are skipped. Missing tokens and rejected
authentication or permissions produce a stderr warning. Other publication
failures return exit code `2` after a successful scan. Commenting uses scan data
directly; it does not depend on JSON or Markdown report files.
Keep the normal `pull_request` trigger; do not switch to `pull_request_target`
to obtain write access for fork code.
