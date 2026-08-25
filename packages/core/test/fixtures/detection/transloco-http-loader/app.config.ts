import { provideTransloco as configureTransloco } from '@jsverse/transloco';
import { TranslocoHttpLoader as AppLoader } from './transloco-loader';

const configLangs = ['en', { id: 'de', label: 'Deutsch' }];

export const providers = [configureTransloco({
	availableLangs: configLangs,
	loader: AppLoader
})];
