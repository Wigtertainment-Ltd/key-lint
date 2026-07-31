import { ApplicationConfig, provideZoneChangeDetection, Injector } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideHttpClient } from '@angular/common/http';
// import { providePrimeNG } from 'primeng/config';
// import Aura from '@primeuix/themes/aura';
import { routes } from './app.routes';
import { setLoggerInjector } from './shared/services/logging/logger';

export const appConfig: ApplicationConfig = {
	providers: [
		provideZoneChangeDetection({ eventCoalescing: true }),
		provideHttpClient(),
		provideTranslateService({
			loader: provideTranslateHttpLoader({
				prefix: './assets/i18n/',
				suffix: '.json',
			}),
			fallbackLang: 'en',
			lang: 'en',
		}),
		provideRouter(routes),
		// providePrimeNG({
		// 	theme: {
		// 		preset: Aura,
		// 		options: {
		// 			darkModeSelector: 'system'
		// 		}
		// 	}
		// })
	]
};
