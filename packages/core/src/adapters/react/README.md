# React / react-i18next adapter

The default adapter registry detects projects with `react` and `react-i18next`
dependencies. CLI and desktop scans use the same adapter.

- Local JSON resources in `locales/<locale>/<namespace>.json`,
  `public/locales/<locale>/<namespace>.json`, `src/locales/<locale>/<namespace>.json`
  or configured translation paths. Legacy `<locale>.json` files use `defaultNS`.
- Imported `useTranslation` bindings, aliases, tuple or object destructuring,
  namespaces, `keyPrefix` and statically configured `i18next.init({ defaultNS })`.
- `<Trans>` with an explicit `i18nKey`, including imported aliases, bound `t`,
  interpolation values and JSX interpolation objects.
- JSON v4 cardinal and ordinal plurals using each locale's plural categories;
  count and optional `_zero` overrides.
- Literal and computed keys, fallback key arrays, missing/unused keys, per-locale
  consistency and interpolation contracts. Dynamic expressions produce warnings.

Keys are reported as `namespace:key`. Namespace files remain separate when the
desktop adds a missing translation. Interpolation supports `{{name}}`,
`{{- html}}` and formatted values such as `{{price, number}}`.

Unsupported: implicit Trans keys, dynamic namespace or keyPrefix configuration,
namespace fallback lists, custom i18n instances, HTTP resources, legacy plural
suffix formats, React Intl and Lingui. Unsupported namespace configuration fails
with a diagnostic rather than guessing its meaning.

Fixtures under `test/fixtures/react/react-i18next-json` cover basic usage,
namespaces, configured defaults, Trans placeholders, plurals and dynamic keys.
