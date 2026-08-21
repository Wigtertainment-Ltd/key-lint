export class AppComponent {
	params = { name: 'Ada', count: 2 };

	load(translateService: { instant(key: string, params?: unknown): string }): void {
		translateService.instant('APP.MISSING');
		translateService.instant('APP.DYNAMIC', this.params);
	}
}
