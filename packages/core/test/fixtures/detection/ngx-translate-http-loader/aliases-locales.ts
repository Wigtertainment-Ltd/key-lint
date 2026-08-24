import { provideTranslateHttpLoader as importedProvider } from '@ngx-translate/http-loader';
import { provideTranslateService as configureTranslations } from '@ngx-translate/core';

const LANGS = ['en', 'de', 'fr'] as const;
export const SUPPORTED_LOCALES = LANGS;
const loaderProvider = importedProvider;

export const loader = loaderProvider({ prefix: '/locale/', suffix: '.json' });
export const translations = configureTranslations({ lang: 'it', fallbackLang: 'en' });
