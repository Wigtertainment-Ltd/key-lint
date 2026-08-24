import { provideTranslateHttpLoader as provideHttp } from '@ngx-translate/http-loader';

const resources = [
	'/assets/shared/',
	{ prefix: 'https://cdn.example.com/features/', suffix: '.lang.json' },
	{ prefix: '/assets/overrides/' }
] as const;

export const loader = provideHttp({ resources });
