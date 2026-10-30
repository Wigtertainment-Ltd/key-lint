import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { setLoggerInjector } from './app/shared/services/logging/logger';
import type { ApplicationRef } from '@angular/core';

bootstrapApplication(AppComponent, appConfig)
	.then((appRef: ApplicationRef): void => {
		if (appRef?.injector) {
			setLoggerInjector(appRef.injector);
		}
	})
	.catch((err: unknown): void => console.error(err));
