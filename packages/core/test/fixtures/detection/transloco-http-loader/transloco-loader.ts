import { HttpClient as AngularHttp } from '@angular/common/http';
import { TranslocoLoader } from '@jsverse/transloco';

export class TranslocoHttpLoader implements TranslocoLoader {
	constructor(private readonly http: AngularHttp) {}

	getTranslation(lang: string) {
		return this.http.get(`https://cdn.example.com/i18n/${lang}.json`);
	}
}
