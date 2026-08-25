class HttpClient {}
class Loader {
	constructor(private http: HttpClient) {}
	getTranslation(lang: string) {
		return this.http.get(`/fake/${lang}.json`);
	}
}
function provideTransloco(_config: unknown) {}
provideTransloco({ loader: Loader });
