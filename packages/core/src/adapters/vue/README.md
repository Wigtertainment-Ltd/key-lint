# Vue translation libraries

Research snapshot: 9 September 2026. These packages are candidates for future
KeyLint adapters; listing them here does not mean they are supported yet.

| Priority | Library | npm package | Latest stable | Last release | Activity |
| ---: | --- | --- | ---: | --- | --- |
| 1 | Vue I18n | `vue-i18n` | `11.4.10` | Late August 2026 | Very active |
| 2 | i18next-vue | `i18next-vue` + `i18next` | `5.4.0` | Around January 2026 | Moderately active |
| 3 | Lingui | `@lingui/core` + `@lingui/extractor-vue` | `6.6.0` | 24 July 2026 | Active |

Typical usages that an adapter should recognize:

```vue
{{ $t('common.save') }}
```

```ts
const { t } = useI18n();
t('common.save');
```

Vue I18n is the primary candidate and the de facto standard for Vue. There is
no regular `@lingui/vue` runtime package analogous to `@lingui/react`; Vue uses
Lingui Core with the Vue extractor, so Lingui should be modeled separately.
