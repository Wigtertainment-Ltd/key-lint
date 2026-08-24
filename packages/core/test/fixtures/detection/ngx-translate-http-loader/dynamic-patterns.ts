import { TranslateLoader } from '@ngx-translate/core';
import { provideTranslateHttpLoader, TranslateHttpLoader } from '@ngx-translate/http-loader';

declare const environment: { translationUrl: string };
declare const production: boolean;
declare const baseConfig: object;
declare const http: unknown;
declare function transformPrefix(value: string): string;
declare function arbitraryFactory(): TranslateLoader;

provideTranslateHttpLoader({ prefix: environment.translationUrl });
provideTranslateHttpLoader({ prefix: production ? '/prod/' : '/dev/' });
provideTranslateHttpLoader({ ...baseConfig, suffix: '.json' });
provideTranslateHttpLoader({ prefix: transformPrefix('/assets/') });

const conditionalLoader = production
	? new TranslateHttpLoader(http, '/first/', '.json')
	: new TranslateHttpLoader(http, '/second/', '.json');

export const unsupportedProvider = {
	provide: TranslateLoader,
	useFactory: arbitraryFactory
};
