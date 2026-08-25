import { HttpClient } from '@angular/common/http';
import { provideTransloco } from '@jsverse/transloco';
import { environment } from './environment';

class EnvironmentLoader {
	constructor(private http: HttpClient) {}
	getTranslation(lang: string) {
		return this.http.get(environment.api + lang + '.json');
	}
}

class ConditionalLoader {
	constructor(private http: HttpClient) {}
	getTranslation(lang: string) {
		return this.http.get(lang === 'de' ? `/de/${lang}.json` : `/other/${lang}.json`);
	}
}

provideTransloco({ loader: EnvironmentLoader });
provideTransloco({ loader: ConditionalLoader });
