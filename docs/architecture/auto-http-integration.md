# Automatic HTTP translation source integration

The `auto-http` source connects the static ngx-translate and Transloco loader
analyzers with the existing explicit HTTP translation pipeline. Detection and
selection complete before a source can reach `runScan()`. The scan engine and
remote fetchers therefore receive only validated `filesystem` and `http`
sources.

## Configuration and expansion

An `auto-http` source accepts an optional stable `id`, optional `origin`,
optional locale override, and `headersFromEnv`. Relative detected templates
require an HTTP(S) origin. Configured locales replace detected locales; when
neither is available, expansion fails.

One selected loader candidate may expose several ordered resources. Expansion
replaces the `auto-http` entry in place with one explicit HTTP source per
resource, preserving candidate order and the position relative to filesystem
and other HTTP sources. Header environment mappings are copied to each expanded
resource and continue through the existing validation and redaction paths.

The pure resolver is exported from the browser-safe Core entry point. Project
TypeScript collection and compiler-based analysis remain in
`@key-lint/core/detection`, so importing the normal Core API does not add the
TypeScript compiler to browser bundles.

## CLI workflow

The CLI requires `--allow-network` whenever `auto-http` is configured. It then:

1. reads matching TypeScript files as text;
2. runs both static analyzers without importing project modules;
3. requires exactly one candidate;
4. resolves origin and locales and prints the selected location and endpoints;
5. passes expanded explicit HTTP sources to the normal scan.

Zero candidates, multiple candidates, missing origins, or missing locales fail
before the Node fetcher is used. Errors include source locations where
available and an explicit HTTP configuration fallback.

## Desktop workflow and IPC boundary

The Angular renderer lists project TypeScript files through the existing
filesystem adapter. Compiler analysis runs in Electron's main process through
the fixed `keylint:translations:analyze-loaders` IPC channel; this keeps Node
compiler dependencies out of the sandboxed renderer. IPC input accepts only
absolute `.ts`/`.tsx` paths and string content, with limits of 2,000 files and
20 MiB total source text.

The project-selection page displays framework/API, source location, templates,
detected locales, and analyzer diagnostics. A single candidate is selected
automatically; multiple candidates require an explicit user choice. Missing
origin or locale data blocks confirmation. Once complete, the resolver creates
the same explicit sources used by the CLI and the existing per-scan network
confirmation displays their resolved endpoints, origins, locales, and header
names.

Temporary header values remain only in memory, are never included in candidate
or confirmation data, and are cleared through the existing reset, cancellation,
and scan-finalization paths. No network request is made by detection, selection,
or expansion.
