# Remote translation guide

Remote translation documents must be JSON objects. KeyLint never writes them.
Every runtime keeps networking disabled until the user explicitly opts in.

## Source order and merge behavior

`translationSources` is evaluated from first to last. Filesystem and HTTP sources
may be mixed; remote-only projects are supported. Objects merge recursively, while
later arrays, primitives, `null` values and object/value type conflicts replace
earlier values.

```json
{
  "translationSources": [
    { "type": "filesystem", "id": "base", "includeGlobs": ["locales/**/*.json"] },
    { "type": "http", "id": "tenant", "urlTemplate": "https://api.example.com/{locale}.json", "locales": ["en", "de"] }
  ]
}
```

Authentication uses `headersFromEnv`. Bearer tokens and API keys differ only in
the chosen header name; their values never belong in configuration.

## Automatic loaders

Use `{ "type": "auto-http" }` for a statically analyzable ngx-translate or
Transloco HTTP loader. KeyLint reads TypeScript as text and never imports project
code. A relative template such as `/assets/i18n/{locale}.json` requires an
`origin`, for example `{ "type": "auto-http", "origin": "https://app.example" }`.
Dynamic URLs, ambiguous candidates, transformations and unsupported providers
produce diagnostics and require a manual explicit HTTP source.

## Runtime behavior and limits

- CLI: pass `--allow-network`.
- GitHub Action: set `allow-network: 'true'` and map secrets into `env`.
- Desktop: review endpoints, locales, HTTP/private-target warnings and header
  names, enter temporary values, then confirm each scan.
- Method: GET only; timeout: 15 seconds total; redirects: 3 maximum; distinct
  logical requests: 100 maximum; response size: `guardrails.maxFileSizeBytes`.
- Cross-origin redirects remove sensitive headers. Duplicate requests are reused.
- Query values are redacted. Remote results and mixed results are read-only so a
  merged value can never be written back to an incomplete local source.

Safe report metadata contains only source/request counts, loader framework names
and read-only state. It excludes full endpoint URLs, header values, environment
values and desktop credentials.
