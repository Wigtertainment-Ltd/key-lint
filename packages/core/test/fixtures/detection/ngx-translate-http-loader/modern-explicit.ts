import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

const prefix = 'https://cdn.example.com/i18n/';
const suffix = '.translations.json';

export const loader = provideTranslateHttpLoader({ prefix, suffix });
