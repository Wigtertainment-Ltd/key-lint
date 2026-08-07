export class AppComponent {
	constructor(private readonly translocoService: { translate: (key: string) => string }) {
		this.translocoService.translate('APP.TITLE');
		this.translocoService.translate('APP.MISSING');
	}
}
