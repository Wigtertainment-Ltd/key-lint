# React translation libraries

Research snapshot: 9 September 2026. These packages are candidates for future
KeyLint adapters; listing them here does not mean they are supported yet.

| Priority | Library | npm package | Latest stable | Last release | Activity |
| ---: | --- | --- | ---: | --- | --- |
| 1 | react-i18next | `react-i18next` + `i18next` | `17.0.13` | Early September 2026 | Very active |
| 2 | React Intl / FormatJS | `react-intl` | `10.1.26` | Early September 2026 | Very active |
| 3 | Lingui | `@lingui/react` + `@lingui/core` | `6.6.0` | 24 July 2026 | Active |

Typical usages that an adapter should recognize:

```tsx
t('common.save');
<Trans i18nKey="common.save" />;
intl.formatMessage({ id: 'common.save' });
<FormattedMessage id="common.save" />;
```

`react-i18next` is the first candidate because it combines broad adoption with
the wider i18next ecosystem. Lingui needs its own extraction/compile model and
should be treated as a translation system rather than only a React integration.
