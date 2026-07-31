import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { setLoggerInjector } from './app/shared/services/logging/logger';

bootstrapApplication(AppComponent, appConfig)
	.then((appRef) => {
		if (appRef?.injector) {
			setLoggerInjector(appRef.injector);
		}
	})
	.catch((err) => console.error(err));
