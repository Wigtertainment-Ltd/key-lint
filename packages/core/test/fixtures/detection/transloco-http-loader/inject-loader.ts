import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';

const PREFIX = '/assets/i18n/';
class Loader {
	private readonly client = inject(HttpClient);
	getTranslation(locale: string) {
		return this.client.get(PREFIX + locale + '.json');
	}
}

provideTransloco({ loader: Loader });
