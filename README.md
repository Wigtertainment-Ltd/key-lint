# KeyLint

Desktop tool, CLI and GitHub Action for auditing i18n translation keys in Angular projects.

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
3. The workflow builds on `windows-latest` and uploads the artifacts as a **draft** release to the
  public repository `Wigtertainment-Ltd/key-lint-releases`.
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

## CI/CD

The scan can run headless in a pipeline:

```bash
npx @key-lint/cli scan . --max-errors 0 --output markdown=keylint.md
```

Exit code `0` means the thresholds were respected, `1` that they were exceeded and
`2` that the run itself failed. See [docs/ci/README.md](docs/ci/README.md) for the
full option reference, the `keylint.config.json` schema and ready-to-use
pipeline snippets for GitHub Actions, GitLab CI, Azure DevOps and Jenkins.

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
