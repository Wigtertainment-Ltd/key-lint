import { HttpClient } from '@angular/common/http';
import { TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader as HttpLoader } from '@ngx-translate/http-loader';

export function createTranslateLoader(http: HttpClient): TranslateLoader {
	return new HttpLoader(http, '/legacy/i18n/', '.lang.json');
}

export const loaderProvider = {
	provide: TranslateLoader,
	useFactory: createTranslateLoader,
	deps: [HttpClient]
};
