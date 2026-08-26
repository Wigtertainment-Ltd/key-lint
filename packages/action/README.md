# KeyLint GitHub Action

The composite Action runs `@key-lint/cli`, writes JSON and Markdown reports and
optionally appends the Markdown report to the job summary. Network access is
disabled by default and cannot be enabled by project configuration.

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

All other inputs and outputs are defined in [`action.yml`](action.yml). Automatic
sources use `type: "auto-http"` and follow the same opt-in and secret mapping.
