import { HttpClient } from '@angular/common/http';
import { provideTransloco } from '@jsverse/transloco';

throw new Error('this fixture must never execute');

class Loader {
	constructor(private http: HttpClient) {}
	getTranslation(lang: string) {
		return this.http.get(`/safe/${lang}.json`);
	}
}

provideTransloco({ loader: Loader });
