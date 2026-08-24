function provideTranslateHttpLoader(config?: unknown): unknown {
	return config;
}

class TranslateHttpLoader {
	constructor(..._args: unknown[]) {}
}

provideTranslateHttpLoader({ prefix: 'https://wrong.example/' });
new TranslateHttpLoader({}, 'https://wrong.example/', '.json');

function shadowImportedProvider(importedProvider: (config: unknown) => unknown): unknown {
	return importedProvider({ prefix: 'https://also-wrong.example/' });
}

void shadowImportedProvider;
import { provideTranslateHttpLoader as importedProvider } from '@ngx-translate/http-loader';
