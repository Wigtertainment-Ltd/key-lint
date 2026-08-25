# Static Transloco HTTP loader detection

The Core API `analyzeTranslocoHttpLoaders()` is exported from
`@key-lint/core/detection`. It parses caller-provided TypeScript source with
the TypeScript compiler parser. It never imports or executes project modules,
starts Angular, resolves dependency injection, or performs network requests.

The Transloco and ngx-translate analyzers share the generic compiler-AST
infrastructure in `packages/core/src/detection/shared`. Import and namespace
aliases, lexical `const` aliases, static string values, local class imports,
source ranges, URL resource metadata, and diagnostic deduplication therefore
follow the same rules for both frameworks. Provider and loader semantics remain
inside their framework-specific analyzers.

## Registration and loader resolution

The analyzer recognizes both current `@jsverse/transloco` and legacy
`@ngneat/transloco` imports. A class is analyzed only when it is registered by:

- `provideTransloco({ loader: LoaderClass })`; or
- `{ provide: TRANSLOCO_LOADER, useClass: LoaderClass }`.

Named aliases, namespace imports, unambiguous `const` aliases, same-file
classes, and named or default classes imported from supplied relative
TypeScript files are resolved. Matching a local symbol by name alone is never
sufficient.

The registered class must expose one `getTranslation(locale)` method and use
Angular's imported `HttpClient`, either as a constructor parameter property or
through `inject(HttpClient)`. Direct `HttpClient.get()` calls are inspected.
The HTTP request is not executed.

## URL and locale extraction

String literals, template literals, `+` concatenation, and unambiguous static
string constants are supported. The `getTranslation` parameter becomes the
single `{locale}` placeholder. Each candidate contains ordered URL templates,
absolute/relative status, `requiresOrigin`, literal locales, confidence, and a
one-based source range.

Literal `availableLangs` arrays support strings and Transloco's object form
with a literal `id`. Conventional top-level locale arrays are collected using
the same naming rules as the ngx-translate analyzer.

Multiple requests are accepted only for the explicit pattern
`forkJoin([...]).pipe(map(([a, b]) => ({ ...a, ...b })))`. Both the request
array and the object-spread merge must declare the same order. That order is
preserved in the candidate resources.

## Diagnostic-only patterns

No candidate is guessed for:

- environment-dependent, conditional, transformed, or otherwise dynamic URLs;
- unresolved or unsupported loader providers;
- multiple requests without explicit request and merge order;
- Transloco scopes, whose resource paths are composed at runtime; or
- Angular HTTP interceptors, which can modify request URLs.

Diagnostics provide stable codes, categories, messages, and source locations.
Candidate selection, origin configuration, authentication, and HTTP fetching
remain outside this analyzer and are handled by later integration layers.
