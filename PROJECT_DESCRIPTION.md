# Check-i18n - Project Description

## Overview
Check-i18n is a desktop utility built with Angular and Electron. The application is designed to let a user select an existing project folder and run i18n-related checks on it.

At the current stage, the project already includes the folder selection flow and core desktop integration, while the actual i18n checking logic is still a placeholder.

## Goals
- Provide a simple desktop interface to select a target project
- Analyze translation files and usage consistency in the selected project
- Help detect missing, unused, or inconsistent i18n keys
- Offer a foundation for future automated i18n validation workflows

## Current Feature Set
- Electron desktop shell with Angular frontend
- Modal-based UI for selecting a project directory
- Display of selected project name and full path
- Integration with Electron dialog APIs through an Angular service
- Basic ngx-translate configuration with default language set to English
- Sample translation file in `src/assets/i18n/en.json`

## Architecture
### Runtime Structure
- Main process: `app.js`
- Renderer process (Angular standalone app): `src/main.ts`
- Root component and UI flow: `src/app/app.component.ts` + `src/app/app.component.html`
- Electron bridge service: `src/app/shared/services/electron.service.ts`

### Startup Flow
1. `npm start` triggers Angular build.
2. Electron launches and opens the built Angular app from `dist/check-i18n/browser/index.html`.
3. The app shows a modal asking the user to select a project folder.
4. The selected folder path and project name are displayed.
5. The Check action is available, but its logic is currently not implemented.

## Technology Stack
- Angular 18 (standalone bootstrap)
- Electron 31
- TypeScript 5.5
- SCSS
- PrimeNG + PrimeFlex (UI styling framework)
- `@wigtertainment-ltd/comp-lib` (custom UI components)
- `@ngx-translate/core` + `@ngx-translate/http-loader` (i18n loader setup)
- Jasmine + Karma (unit testing setup)

## Build, Run, and Test
- Install dependencies: `npm install`
- Start desktop app: `npm start`
- Build frontend only: `npm run build`
- Run unit tests: `npm test`

## Project Structure (Key Files)
- `app.js`: Electron main process and BrowserWindow setup
- `src/main.ts`: Angular app bootstrap
- `src/app/app.config.ts`: Provider and translation module setup
- `src/app/app.routes.ts`: Router configuration (currently empty)
- `src/app/app.component.ts`: Main UI logic
- `src/app/shared/services/electron.service.ts`: Access to Electron and Node APIs from Angular
- `src/assets/i18n/en.json`: Base English translation resource

## Current Status and Limitations
- The core check function in `checkProject()` is currently a placeholder.
- Routing is configured but not used yet.
- Global and component-level SCSS files are mostly empty.
- Existing unit tests in `src/app/app.component.spec.ts` are still default scaffold tests and do not match the current component implementation.
- TypeScript currently reports a config issue in `tsconfig.json` related to `rootDir`/common source directory setup.

## Suggested Next Milestones
1. Implement `checkProject()` with concrete i18n validation rules.
2. Add result reporting in the UI (summary + detailed findings).
3. Replace scaffold tests with tests for project selection and validation logic.
4. Introduce stronger TypeScript strictness (`strict: true`) after test coverage is improved.
5. Add export options (for example JSON/Markdown reports) for CI or documentation workflows.

## Notes
This project is a solid starting point for a desktop i18n auditing tool. The Electron integration and base UI flow are already in place, so the next major value comes from implementing robust analysis logic and test coverage.
