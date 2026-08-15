<div align="center">

<img src="public/logo.png" alt="KeyLint logo" width="128" height="128">

# KeyLint

**Catch missing, unused and inconsistent Angular translation keys before they reach production.**

Run it as a desktop app while you code, or wire it into your CI pipeline so a broken
translation never gets merged again.

[Desktop app](#-desktop-app) · [CLI](#-command-line) · [CI/CD](#-cicd-integration) · [GitHub Action](#github-action) · [Docker](#docker)

</div>

---

## Why KeyLint?

Translation keys drift. Someone renames a key, forgets a locale, or leaves a dead
key behind after a refactor - and nobody notices until a user sees a raw
`DASHBOARD.TITLE` on screen. KeyLint scans your source **and** your translation
files and tells you exactly what is wrong:

- 🔴 **Missing keys** - used in code/templates but absent in a locale file
- 🟡 **Unused keys** - defined in a locale file but never referenced
- 🟡 **Extra keys** - present in one locale but missing in the base language
- 🟡 **Dynamic / indirect keys** - resolved at runtime, flagged so you can review them
- ✅ **Used keys** - confirmed and safe

The desktop app and the CLI run the **exact same scan engine**, so what you see
while developing is what your pipeline enforces.

---

## 💻 Desktop app

The fastest way to audit a project. No config required.

1. Download the latest Windows installer or portable build from the
   [Releases](https://github.com/Wigtertainment-Ltd/key-lint/releases) page.
2. Launch KeyLint and pick your project folder - the framework is detected
   automatically.
3. Explore the results:

   | View | What it gives you |
   | --- | --- |
   | **Dashboard** | KPI metrics and a scan-trend chart with day drilldown |
   | **Results** | Filterable findings with evidence snippets, file/line and copy actions |
   | **Translation keys** | A locale matrix (keys × languages) with filters and a detail panel |
   | **History** | Every scan and change tracked per project |

4. **Fix missing translations in place** - type the value and KeyLint writes it
   back into the correct (nested) spot in your locale JSON.

> Light/dark theme included, with a `prefers-color-scheme` fallback.

---

## ⚙️ Using KeyLint in your project

KeyLint works out of the box for **Angular projects using ngx-translate** with
**JSON** locale files. The scanner already knows the common layouts:

- Translation files: `src/assets/i18n/**/*.json`, `assets/i18n/**/*.json`,
  `i18n/**/*.json`, `locales/**/*.json`, plus the usual Nx `apps|libs|packages`
  paths.
- Source files: `**/*.html` and `**/*.ts`.

Nothing to configure to get started. When you need to tune it, drop a
`keylint.config.json` in your project root (or a `"keylint"` key in
`package.json`):

```json
{
  "baseLocale": "en",
  "includeTranslationGlobs": ["src/assets/i18n/**/*.json"],
  "includeSourceGlobs": ["**/*.html", "**/*.ts"],
  "excludeGlobs": ["**/node_modules/**", "**/dist/**"],
  "ignoreKeys": ["LEGACY.**", "VENDOR.*"]
}
```

`baseLocale` is optional. Without it, KeyLint selects exact `en`, then the most
complete `en-*` locale, and finally the most complete discovered locale. Missing
and extra findings are emitted per affected locale. An explicitly configured
locale that cannot be found is a configuration error.

Precedence is: built-in defaults < `package.json` < config file < CLI flags.
Arrays are replaced (never merged), and the config file is pure JSON - it can
never execute code.

The desktop app reloads `package.json` and `keylint.config.json` before every
scan and uses the same validation and merge rules as the CLI. CLI flags remain
the only CLI-specific precedence level.

After selecting a project, the desktop app shows the effective file-count and
file-size guardrails together with their source. Values changed there apply only
to the next analysis and do not modify project files. Desktop precedence is:
built-in defaults < `package.json` < `keylint.config.json` < pre-scan override.

Translation files must contain valid JSON with an object at the root. An
unreadable or invalid file stops the scan and reports its path instead of being
silently omitted. The desktop editor applies the same validation before writing,
so malformed files are never replaced with newly generated content.

The configured filesystem guardrails apply equally to desktop and CLI scans.
Both skip oversized files and symbolic links, stop collecting after `maxFiles`,
and report unreadable directories as warnings. Desktop warnings are shown above
every analysis page in the shared app status bar and are also available in the
scan metadata.

---

## 🖥️ Command line

Run the same engine headless - no Electron, no browser. Requires Node ≥ 20.

```bash
# One-off scan, no install
npx @key-lint/cli scan .

# Or install it globally
npm install -g @key-lint/cli
keylint scan /path/to/project --max-errors 0
```

Write machine-readable and human-readable reports at the same time:

```bash
keylint scan . \
  --reporter text \
  --output json=keylint-report/keylint.json \
  --output markdown=keylint-report/keylint.md \
  --max-errors 0
```

| Option | Description |
| --- | --- |
| `--config <file>` | Path to a `keylint.config.json`. |
| `--reporter <name>` | `text`, `json` or `markdown`. Repeatable. Default `text`. |
| `--output <name>=<file>` | Redirect a reporter to a file (also enables it). |
| `--max-errors <n>` | Tolerated `error` findings (missing keys). Default `0`. |
| `--max-warnings <n>` | Tolerated `warning` findings. Default unlimited. |
| `--ignore <glob>` | Translation key glob to drop from the result. Repeatable. |
| `--quiet` | No progress output on stderr. |
| `--no-color` | Disable ANSI colors (also honoured via `NO_COLOR`). |

Progress goes to **stderr**, reports go to **stdout**, so `--reporter json` pipes
cleanly. Exit code `0` means thresholds were respected, `1` means they were
exceeded, `2` means the run itself failed.

Full option reference and reporter details:
[packages/cli/README.md](packages/cli/README.md).

---

## 🔁 CI/CD integration

Fail the build the moment a translation key goes missing.

### GitHub Action

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: npm

- id: keylint
  uses: Wigtertainment-Ltd/key-lint/packages/action@v1
  with:
    path: .
    max-errors: '0'
    ignore: |
      LEGACY.**

# Upload the generated reports
- if: always()
  uses: actions/upload-artifact@v4
  with:
    name: keylint-report
    path: keylint-report/
```

The action appends a Markdown summary to the GitHub job summary and exposes
`exit-code`, `total-findings`, `error-count` and `warning-count` as outputs.

### Docker

```bash
docker pull ghcr.io/wigtertainment/key-lint:latest
docker run --rm -v "$PWD:/work" -w /work ghcr.io/wigtertainment/key-lint scan . --max-errors 0
```

### Other pipelines

Ready-to-use snippets for GitLab CI, Azure DevOps and Jenkins live in
[docs/ci/README.md](docs/ci/README.md), alongside the full configuration schema.

```bash
npx @key-lint/cli scan . --max-errors 0 --output markdown=keylint.md
```

---

## Supported today

| Area | Status |
| --- | --- |
| Framework | Angular (ngx-translate style usage) |
| Translation format | JSON |
| Platforms (desktop) | Windows |

More framework adapters (React/i18next, Vue/vue-i18n) and formats (YAML, XLIFF,
PO) are on the roadmap. Contributions welcome - see
[CONTRIBUTING.md](CONTRIBUTING.md).

---

<br>

# For developers

Everything below is for working **on** KeyLint itself.

## Workspace layout

The repository is an npm workspace:

| Path | Package | Purpose |
| --- | --- | --- |
| `/` | `key-lint` | Angular + Electron desktop app |
| `packages/core` | `@key-lint/core` | Framework-agnostic scan engine (adapters, rules, config) |
| `packages/cli` | `@key-lint/cli` | Headless CLI for CI/CD pipelines |
| `packages/action` | - | GitHub Action wrapping the CLI |

The desktop app and the CLI run the exact same engine. `npm run build:core` has to
run before the Angular build; the `build`, `start` and `test` scripts do that
automatically.

The Electron renderer is isolated and sandboxed: `nodeIntegration` is disabled,
`contextIsolation` is enabled, and `preload.js` exposes only allowlisted dialog
and filesystem operations through `window.keyLint`. Filesystem IPC validates
absolute paths; renderer writes are additionally limited to JSON files and 2 MB.

## Development server

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

## Code scaffolding

Run `ng generate component component-name` to generate a new component. You can also use `ng generate directive|pipe|service|class|guard|interface|enum|module`.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Production build (Windows)

| Script | Purpose |
| --- | --- |
| `npm run build:electron` | Angular production build with `--base-href ./` (required for the `file://` load in Electron) |
| `npm run pack:win` | Unpacked app in `release/win-unpacked/` – fast smoke test, no installer |
| `npm run dist:win` | NSIS installer + portable `.exe` + `latest.yml` in `release/` |
| `npm run publish:win` | Same as `dist:win`, but uploads the artifacts as a draft release (used by CI) |

Packaging is configured in `electron-builder.yml`.

### Releasing

1. Bump `version` in `package.json`.
2. Push a matching tag, e.g. `v1.0.1`. This triggers `.github/workflows/release-windows.yml`.
3. The workflow builds on `windows-latest` and uploads the artifacts as a **draft** release in this
  repository.
4. Review the draft and publish it. Only then do the assets become downloadable and does auto-update
   start serving the new version.

Release publishing and signing are handled by maintainers via repository secrets and the release
workflow configuration. Contributor pull requests do not need access to publishing credentials.

### Auto-update

`electron-updater` checks for updates on startup, but only when the app is packaged and installed.
It is skipped for the dev server and for the portable executable (which cannot update itself).
A failing check is logged and never blocks startup. No token is embedded in the app – the release
repository is public.

### Known limitations

- **SmartScreen reputation still takes time.** Even with valid Trusted Signing, new apps/versions
  can still trigger warnings until reputation is established.
- **Placeholder icon.** `build/icon.png` is a generated stand-in. Replace it with the real artwork
  (256x256 or larger); electron-builder converts it to a multi-size `.ico`.
- **Local build on Windows may fail while extracting `winCodeSign`** with
  `Cannot create symbolic link`. Enabling Windows Developer Mode typically resolves this.

Linux and macOS builds are not configured yet.

## Running unit tests

Run `ng test` to execute the desktop unit tests via [Karma](https://karma-runner.github.io).
Run `npm run test:packages` to execute the engine and CLI tests via Vitest.

## Running end-to-end tests

Run `ng e2e` to execute the end-to-end tests via a platform of your choice. To use this command, you need to first add a package that implements end-to-end testing capabilities.

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

## Contributing

Bug reports and pull requests are welcome – see [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Security issues must be reported privately, see
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Wigtertainment Ltd
