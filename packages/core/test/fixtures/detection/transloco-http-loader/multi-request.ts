import { HttpClient } from '@angular/common/http';
import { provideTransloco } from '@jsverse/transloco';
import { forkJoin, map } from 'rxjs';

class MergedLoader {
	constructor(private http: HttpClient) {}
	getTranslation(lang: string) {
		return forkJoin([
			this.http.get(`/common/${lang}.json`),
			this.http.get(`https://cdn.example.com/app/${lang}.json`)
		]).pipe(map(([common, app]) => ({ ...common, ...app })));
	}
}

provideTransloco({ loader: MergedLoader });
