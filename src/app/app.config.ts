import { ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { routes } from './app.routes';
import { provideAnimations } from '@angular/platform-browser/animations';
import { HttpClient } from '@angular/common/http';
import { TranslateLoader, TranslateModule, TranslateModuleConfig } from '@ngx-translate/core';

function createTranslateLoader(http: HttpClient): TranslateHttpLoader {
	return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

export const provideTranslation = (): TranslateModuleConfig => ({
	defaultLanguage: 'en',
	loader: {
		provide: TranslateLoader,
		useFactory: (createTranslateLoader),
		deps: [HttpClient],
	},
});

export const appConfig: ApplicationConfig = {
	providers: [
		provideAnimations(),
		provideZoneChangeDetection({ eventCoalescing: true }),
		importProvidersFrom(TranslateModule.forRoot(provideTranslation())),
		provideRouter(routes)
	]
};
