# KeyLint - Project Description

## Overview
KeyLint is a desktop utility built with Angular and Electron. It lets a user select an existing local project folder, automatically detects the project framework, scans source files and translation resources, and reports i18n inconsistencies.

The scan engine lives in the standalone package `@key-lint/core` and is shared by two front ends: the Electron desktop app and the headless CLI `@key-lint/cli` for CI/CD pipelines.

The scan pipeline, the adapter architecture, the multi-page analysis UI, and the persisted project history are implemented. Angular (ngx-translate style usage) is currently the only shipped scan adapter, and JSON is the only supported translation format.

## Goals
- Provide a simple desktop interface to select and audit a target project
- Analyze translation files and key usage consistency in the selected project
- Detect missing, unused, extra, and dynamically resolved i18n keys
- Allow missing translations to be filled in directly from the app
- Offer a foundation for future automated i18n validation workflows (more frameworks, more formats, CI export)

## Current Feature Set
- Electron desktop shell with a routed Angular standalone frontend
- Project selection page using the native Electron directory dialog
- Recent projects list (up to 5 entries, persisted in `localStorage`, with existence check)
- Automatic framework detection via an adapter registry with confidence scoring
- Scan progress page reflecting live pipeline stages
- Analysis area with a shared layout and sidebar navigation:
  - Dashboard with KPI metrics and a scan trend chart including day drilldown
  - Results overview with filters, search, detail panel, evidence snippets and copy actions
  - Translation keys page with a locale matrix, filters and detail panel
  - History page based on persisted project events
  - Documentation page
- Direct editing: missing translation values can be written back into the locale JSON file (nested keys are created correctly)
- Persisted project history (`scan-started`, `scan-completed`, `translation-key-added`), max. 500 events per project
- Light/dark theme with `prefers-color-scheme` fallback and `localStorage` persistence
- ngx-translate configuration for the app's own UI language (default `en`)

## Architecture
### Runtime Structure
- Main process: `app.js` (BrowserWindow 1200x800, `@electron/remote`, menu disabled)
- Renderer process (Angular standalone app): `src/main.ts`
- Root component: `src/app/app.component.ts` (router outlet shell + theme initialization)
- Routing: `src/app/app.routes.ts`

### Layering
- `packages/core/` — `@key-lint/core`, the framework-agnostic scan engine
  - `models/finding.model.ts`, `models/scan-result.model.ts`, `models/history-event.model.ts`
  - `adapters/scan-adapter.interface.ts`, `adapters/adapter-registry.ts`, `adapters/default-adapter-registry.ts`
  - `adapters/angular/angular-scan.adapter.ts`
  - `config/scanner-defaults.ts`, `config/scanner-config.ts` (merge + validation), `config/load-config.ts` (Node only)
  - `scan/run-scan.ts` (the pipeline itself)
  - `fs/node-file-system.adapter.ts` (Node only, exported via `@key-lint/core/node`)
  - `util/` (path, glob and translation JSON helpers)
- `packages/cli/` — `@key-lint/cli`, argument parsing, reporters (text/json/markdown), exit codes
- `packages/action/` — GitHub Action wrapping the CLI
- `src/app/shared/services/` — desktop runtime services
  - `electron.service.ts` (Electron/Node bridge)
  - `electron-file-system.adapter.ts` (FileSystemAdapter for the renderer)
  - `scan-orchestration.service.ts` (thin wrapper around `runScan`, state stream, translation writes)
  - `project-history.service.ts`, `recent-projects.service.ts`
- `src/app/pages/` — routed pages
- `src/app/services/theme.service.ts` — theme handling

### Routes
- `/` — project selection
- `/scan-progress` — scan execution feedback
- `/analysis` — layout with children `dashboard`, `translation-keys`, `results`, `history`, `documentation`
- `**` — redirect to `/`

### Scan Pipeline
1. Detect project adapter (parent directories are also probed; best confidence wins)
2. Collect translation files
3. Extract defined translation keys
4. Build the translation matrix (keys x locales)
5. Scan source files for key usage
6. Evaluate scan rules and build findings + summary
7. Emit `ScanExecutionSnapshot` (`idle` / `running` / `completed` / `failed`) and record history events

### Finding Model
- `FindingStatus`: `used`, `unused`, `dynamic-uncertain`, `missing-in-language`, `extra-in-language`
- `FindingSeverity`: `info`, `warning`, `error`
- Each finding carries evidence entries with file path, line, column, snippet and match type

### Angular Adapter Details
- Detection markers: `angular.json`, `nx.json`, `workspace.json`, `project.json`, `package.json` with Angular dependency
- Template patterns: `{{ 'key' | translate }}`, attribute bindings, `translate="key"`, `[translate]="'key'"`
- TypeScript patterns: `translate.instant/get/stream/translate('key')` and similar service calls
- Non-literal arguments are reported as `dynamic-uncertain` instead of being silently ignored

### Scanner Defaults (`DEFAULT_SCANNER_CONFIG`)
- Translation globs: `src/assets/i18n/**/*.json`, `assets/i18n/**/*.json`, `i18n/**/*.json`, `locales/**/*.json`, plus `apps|libs|packages/**/src/assets/i18n/**/*.json`
- Source globs: `**/*.html`, `**/*.ts`
- Excludes: `node_modules`, `dist`, `coverage`, `.git`, `.nx`, `tmp`, `out`
- Ignored keys: none by default (`ignoreKeys`, glob matched against translation keys)
- Guardrails: max. 25.000 files, max. 2 MB per file (enforced by the Node filesystem adapter)

## CLI / CI-CD Usage
- Command: `npx @key-lint/cli scan <path> [options]`
- Reporters: `text` (stdout), `json` (machine readable, without the translation matrix), `markdown` (job summary / PR comment)
- Thresholds: `--max-errors` (default 0), `--max-warnings` (default unlimited)
- Exit codes: `0` thresholds respected, `1` thresholds exceeded, `2` usage/config/runtime error
- Configuration: `keylint.config.json` or a `keylint` key in `package.json`; precedence defaults < package.json < config file < CLI flags
- Distribution: npm packages, GitHub Action (`packages/action`), Docker image (`docker/Dockerfile`)
- Details and pipeline templates: `docs/ci/`

## Startup Flow
1. `npm start` runs `ng serve --hmr` and launches Electron against `http://localhost:4200` once the port is ready.
2. `npm run start:dist` builds the Angular app and loads `dist/key-lint/browser/index.html` in Electron.
3. The app opens on the project selection page (native folder dialog + recent projects).
4. The scan runs with live stage feedback and navigates into the analysis area.
5. Results are explored via dashboard, results overview, translation keys and history.

## Technology Stack
- Angular 18 (standalone bootstrap, standalone components, router)
- Electron 31 + `@electron/remote`
- TypeScript 5.5
- SCSS with centralized design tokens in `src/styles.scss`
- PrimeNG + PrimeFlex (UI styling framework)
- `@wigtertainment-ltd/comp-lib` (custom UI components)
- `@ngx-translate/core` + `@ngx-translate/http-loader` (i18n loader setup)
- Jasmine + Karma (unit testing setup)

## Build, Run, and Test
- Install dependencies: `npm install` (npm workspace, links `@key-lint/core`)
- Start desktop app (dev, HMR): `npm start`
- Start desktop app from build output: `npm run start:dist`
- Build engine only: `npm run build:core`
- Build CLI: `npm run build:cli`
- Build frontend: `npm run build`
- Run desktop unit tests: `npm test`
- Run engine and CLI tests (Vitest): `npm run test:packages`
- Lint: `npm run lint`

## Project Structure (Key Files)
- `app.js`: Electron main process and BrowserWindow setup
- `src/main.ts`: Angular app bootstrap
- `src/app/app.config.ts`: Provider and translation module setup
- `src/app/app.routes.ts`: Router configuration for selection, scan and analysis pages
- `src/app/app.component.ts`: Router outlet shell and theme initialization
- `packages/core/src/adapters/scan-adapter.interface.ts`: Contract every scan adapter implements
- `packages/core/src/config/scanner-defaults.ts`: Default globs, excludes and guardrails
- `packages/core/src/adapters/angular/angular-scan.adapter.ts`: Angular/ngx-translate scan adapter
- `packages/core/src/scan/run-scan.ts`: The scan pipeline shared by desktop app and CLI
- `packages/cli/src/cli.ts`: CLI entry logic, reporter selection and exit codes
- `src/app/shared/services/scan-orchestration.service.ts`: Desktop state wrapper and translation writes
- `src/app/shared/services/project-history.service.ts`: Persisted project history events
- `src/app/shared/services/electron.service.ts`: Access to Electron and Node APIs from Angular
- `src/assets/i18n/en.json`: Base English translation resource for the app UI

## Current Status and Limitations
- Only the Angular adapter is implemented; `TranslationFormat` already declares `yaml`, `xliff` and `po`, but only `json` is supported.
- Persistence for recent projects and history relies on `localStorage`, not on files on disk.
- No report export (JSON/Markdown/CSV) and no CI integration yet.
- Scanning requires the Electron runtime; in a plain browser context the filesystem adapter returns no files.
- Test coverage is limited to `src/app/app.component.spec.ts` and `src/app/adapters/angular/angular-scan.adapter.spec.ts`.
- `strict: true` is not enabled in the TypeScript configuration.

## Suggested Next Milestones
1. Add further framework adapters (React/i18next, Vue/vue-i18n).
2. Support additional translation formats (YAML, XLIFF, PO).
3. Add report export (JSON/Markdown/CSV) for CI and documentation workflows.
4. Add CI thresholds so builds can fail on missing keys.
5. Expand test coverage across orchestration, history and page logic, then enable stricter TypeScript settings.

## Notes
The project has moved from a prototype shell to a working i18n auditing tool with a clear separation between core contracts, framework adapters and UI. The main remaining value lies in broadening framework/format support and adding export plus CI integration.
