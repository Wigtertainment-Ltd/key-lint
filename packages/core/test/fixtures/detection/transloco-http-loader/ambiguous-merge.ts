import { HttpClient } from '@angular/common/http';
import { provideTransloco } from '@jsverse/transloco';

class Loader {
	constructor(private http: HttpClient) {}
	getTranslation(lang: string) {
		const first = this.http.get(`/first/${lang}.json`);
		const second = this.http.get(`/second/${lang}.json`);
		return mergeTranslations(first, second);
	}
}

provideTransloco({ loader: Loader });
