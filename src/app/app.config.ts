import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideHttpClient } from '@angular/common/http';
import { routes } from './app.routes';

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
		provideRouter(routes)
	]
};
