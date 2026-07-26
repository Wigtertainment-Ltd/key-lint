# CheckL18n

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 18.1.4.

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
   public repository `Wigtertainment-Ltd/Check-i18n-releases`.
4. Review the draft and publish it. Only then do the assets become downloadable and does auto-update
   start serving the new version.

The workflow needs a repository secret `RELEASES_TOKEN`: a fine-grained PAT scoped to
`Wigtertainment-Ltd/Check-i18n-releases` with `Contents: Read and write`. The built-in `GITHUB_TOKEN`
is not sufficient because it only covers this repository.

For Windows code signing, the workflow is configured for **Microsoft Trusted Signing**. Add these
repository secrets in `Wigtertainment-Ltd/Check-i18n`:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT` (for example `https://weu.codesigning.azure.net`)
- `AZURE_CODE_SIGNING_ACCOUNT_NAME`
- `AZURE_CERTIFICATE_PROFILE_NAME`

Optional for manual test-signing runs:

- `AZURE_CERTIFICATE_PROFILE_NAME_TEST`

The service principal behind these credentials needs permission to sign with the selected
Trusted Signing account/profile in Azure.

When you run the workflow manually, you can choose `signingProfile = test|prod`.
Tag-based releases (`v*`) always use the production profile (`AZURE_CERTIFICATE_PROFILE_NAME`).

Manual runs also expose `runTests`:

- `false`: skip unit tests (useful for a pure signing/publishing smoke test)
- `true`: run unit tests before build

Tag-based releases always run tests.

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
  `Cannot create symbolic link`. The archive contains macOS symlinks that require elevated rights.
  Enable Windows Developer Mode, or pre-populate the cache once:

  ```powershell
  $target = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign\winCodeSign-2.6.0'
  $tmp = Join-Path $env:TEMP 'winCodeSign-2.6.0.7z'
  Invoke-WebRequest -Uri 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z' -OutFile $tmp
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  & .\node_modules\7zip-bin\win\x64\7za.exe x -bd -y "-o$target" $tmp '-x!darwin'
  ```

Linux and macOS builds are not configured yet.

## Running unit tests

Run `ng test` to execute the unit tests via [Karma](https://karma-runner.github.io).

## Running end-to-end tests

Run `ng e2e` to execute the end-to-end tests via a platform of your choice. To use this command, you need to first add a package that implements end-to-end testing capabilities.

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
