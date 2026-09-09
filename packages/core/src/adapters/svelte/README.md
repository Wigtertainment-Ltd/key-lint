# Svelte translation libraries

Research snapshot: 9 September 2026. These packages are candidates for future
KeyLint adapters; listing them here does not mean they are supported yet.

| Priority | Library | npm package | Latest stable | Last release | Activity |
| ---: | --- | --- | ---: | --- | --- |
| 1 | Paraglide JS | `@inlang/paraglide-js` | `2.25.1` | 9 September 2026 | Extremely active |
| 2 | svelte-i18n | `svelte-i18n` | `4.0.1` | Around 2024 | Low |
| 3 | Lingui | `@lingui/core` | `6.6.0` | 24 July 2026 | Active |

Typical usages that an adapter should recognize:

```svelte
<script>
  import { m } from './paraglide/messages.js';
  import { _ } from 'svelte-i18n';
</script>

<h1>{m.common_save()}</h1>
<button>{$_('common.save')}</button>
```

Paraglide is the first candidate for new SvelteKit projects. Its compiler turns
messages into typed functions, so its static-analysis model differs from classic
string-key libraries. `svelte-i18n` remains relevant for existing projects, but
its release cadence and current maintenance status make it a lower priority.
