import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

const prefix = '/outside/';

export function configureLoader(): unknown {
	const prefix = '/inside/';
	return provideTranslateHttpLoader({ prefix });
}

export const outsidePrefix = prefix;
