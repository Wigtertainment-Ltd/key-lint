import { HTTP_INTERCEPTORS, HttpClient, withInterceptors } from '@angular/common/http';
import { provideTransloco, provideTranslocoScope, TRANSLOCO_SCOPE } from '@jsverse/transloco';

class Loader {
	constructor(private http: HttpClient) {}
	getTranslation(lang: string) {
		return this.http.get(`/unsafe/${lang}.json`);
	}
}

provideTransloco({ loader: Loader });
provideTranslocoScope('admin');
export const providers = [
	{ provide: TRANSLOCO_SCOPE, useValue: 'todos' },
	{ provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
	withInterceptors([authInterceptor])
];
