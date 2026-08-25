import { HttpClient } from '@angular/common/http';
import { TRANSLOCO_LOADER } from '@ngneat/transloco';

class LegacyLoader {
	constructor(public http: HttpClient) {}
	getTranslation(language: string) {
		return this.http.get(`/legacy/${language}.lang.json`);
	}
}

export const providers = [{ provide: TRANSLOCO_LOADER, useClass: LegacyLoader }];
