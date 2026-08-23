# Electron remote translation boundary

Remote translation traffic crosses a dedicated Electron IPC boundary. The
renderer never receives Node, environment, or general-purpose network access.
This transport exists in Issue #9 but is intentionally not connected to the
desktop scan workflow until the configuration and confirmation flow is added.

## Data flow

1. Core calls an `IRemoteTranslationFetcher` with one validated translation
   request.
2. `ElectronRemoteTranslationFetcher` adds a short-lived scan identifier and
   invokes `keylint:translations:fetch-resource` through the frozen preload API.
3. The main process validates the complete payload before accessing the network.
4. The main process performs a GET with manual redirect handling, streams and
   validates the JSON response, and returns only `{ body, finalUrl }`.
5. The renderer closes the scan session through
   `keylint:translations:end-scan`, removing its deduplication state.

The IPC response is an explicit success/error envelope. Unknown exceptions are
replaced with a generic failure, so Electron serialization cannot accidentally
expose an underlying request, header, or credential.

## Allowed contract

The request contains only:

- a constrained per-scan identifier;
- the literal method `GET`;
- an absolute HTTP(S) URL without embedded credentials;
- an object of syntactically valid header names and string values;
- the fixed 15-second timeout and three-redirect limit;
- a positive response-size limit, with a defensive 64 MiB main-process cap.

Unknown fields, invalid payload shapes, other methods and protocols are rejected
before the fetch implementation is called. The preload does not expose `fetch`,
request constructors, environment access, arbitrary IPC invocation, or any
other network primitive.

## Guardrails

- total timeout: 15 seconds across the complete redirect chain and body stream;
- redirects: at most three, with every target parsed and revalidated;
- headers: authorization, cookies, API keys, tokens and secret-like headers are
  removed when a redirect changes origin;
- response size: `maxFileSizeBytes` is enforced while streaming, as well as by
  `Content-Length` when supplied;
- request count: at most 100 distinct URLs per scan identifier;
- deduplication: the same URL and request metadata share one promise;
- conflicts: the same URL with different headers or size limits is rejected;
- content: the body must be valid JSON with an object at the root.

## Threat model

The renderer is treated as untrusted at the IPC boundary. It may send malformed
or deliberately oversized payloads, attempt non-HTTP protocols, try methods that
write data, repeat requests, or include secrets that could leak through error
serialization. Main-process validation and fixed operation names contain those
attempts.

This boundary is not an origin allowlist. A URL is permitted only after the user
configuration and confirmation workflow authorizes network access. That policy
belongs to the desktop orchestration feature; the transport independently
enforces protocol, method, redirect, resource and serialization safety.

Diagnostics redact all query values. Header values never appear in errors or IPC
error envelopes. The main process does not log transport requests or failures.
