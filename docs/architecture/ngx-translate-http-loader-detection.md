# Static ngx-translate HTTP loader detection

The Core API `analyzeNgxTranslateHttpLoaders()` is exported from
`@key-lint/core/detection` and parses caller-provided TypeScript source text
with the TypeScript compiler parser. It does not create
an Angular application, resolve dependency injection, import project modules,
evaluate expressions, or perform network requests.

## Candidate contract

A deterministic candidate identifies ngx-translate's HTTP loader API and
contains ordered resource URL templates, any supported literal locales found
in the analyzed input, absolute/relative status, an explicit `requiresOrigin`
flag, and a one-based source range. Relative templates remain relative.

Only imports from `@ngx-translate/http-loader` are recognized. Matching local
functions or classes with the same names does not create a candidate. Named
import aliases, namespace imports, and unambiguous `const` aliases are resolved
statically.

## Supported modern patterns

The analyzer recognizes calls to `provideTranslateHttpLoader()` with:

- no configuration, producing `/assets/i18n/{locale}.json`;
- an object literal or unambiguous `const` object alias;
- literal or unambiguously aliased `prefix` and `suffix` values;
- a literal `resources` array whose order is preserved;
- resource strings, interpreted as prefixes with the default `.json` suffix;
- resource objects containing a literal `prefix` and optional literal `suffix`.

String literals and interpolation-free template literals are equivalent.
Parentheses, `as const`, type assertions, non-null assertions, and `satisfies`
wrappers are unwrapped without evaluation.

## Supported legacy patterns

The analyzer recognizes `new TranslateHttpLoader(http, prefix, suffix)` when
the class resolves to `@ngx-translate/http-loader`. The HTTP client expression
is not evaluated. Omitted prefix and suffix use `/assets/i18n/` and `.json`.
The constructor may appear inside a loader factory, including a factory named
by a `TranslateLoader` provider.

## Supported locale declarations

Literal, top-level arrays named `locales`, `languages`, or `langs`, optionally
prefixed with `supported`, `available`, or `app`, are collected in declaration
order. Uppercase and underscore-separated variants are accepted, and
unambiguous `const` aliases may point to the array.

Literal `lang` and `fallbackLang` properties passed to an imported
`provideTranslateService()` call are also collected. Duplicate locale values
are removed while retaining their first position.

## Diagnostic-only patterns

The following constructs never produce a guessed candidate:

- runtime environment or `process.env` URL values;
- conditional URL construction or conditionally selected loader calls;
- object or array spreads and other non-literal merge logic;
- function calls, tagged templates, and custom URL transformations;
- ambiguous references with multiple visible declarations;
- arbitrary `TranslateLoader` factories without a supported constructor.

Diagnostics include a stable code, category, actionable message, and one-based
source range. Consumers decide how to present or resolve them; candidate
selection and resource fetching are intentionally outside this analyzer.
