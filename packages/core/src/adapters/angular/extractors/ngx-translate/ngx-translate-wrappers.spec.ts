import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { findNgxTranslateWrappers, INgxTranslateWrapper } from './ngx-translate-wrappers.js';

function findWrapperParameters(content: string): [string, number][] {
	const fileName: string = '/project/labels.service.ts';
	const sourceFile: ts.SourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
	const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [] };
	const host: ts.CompilerHost = {
		...ts.createCompilerHost(options),
		getSourceFile: (name: string): ts.SourceFile | undefined => name === fileName ? sourceFile : undefined,
		fileExists: (name: string): boolean => name === fileName,
		readFile: (name: string): string | undefined => name === fileName ? content : undefined
	};
	const program: ts.Program = ts.createProgram([fileName], options, host);
	const wrappers: ReadonlyMap<ts.MethodDeclaration, INgxTranslateWrapper> = findNgxTranslateWrappers(sourceFile, program.getTypeChecker());
	return Array.from(wrappers, ([method, wrapper]: [ts.MethodDeclaration, INgxTranslateWrapper]): [string, number] =>
		[method.name.getText(sourceFile), wrapper.keyArgumentIndex]
	);
}

describe('findNgxTranslateWrappers', (): void => {
	it('proves direct wrappers around an aliased TranslateService from constructor and field injection', (): void => {
		const wrappers: [string, number][] = findWrapperParameters(`
			import { inject as useService, Inject as UseToken } from '@angular/core';
			import { TranslateService as Translator } from '@ngx-translate/core';

			class Labels {
				private readonly field = useService(Translator);
				constructor(private readonly service: Translator, @UseToken(Translator) private readonly token: { instant(key: string): string }) {}

				translate(key: string, params?: object): string {
					return this.service.instant(key, params);
				}

				labelFor(this: Labels, params: object, key: string): string {
					return this.field.instant(key, params);
				}

				explicit(key: string): string {
					return this.token.instant(key);
				}
			}
		`);

		expect(wrappers).toEqual([['translate', 0], ['labelFor', 1], ['explicit', 0]]);
	});

	it('requires the actual ngx TranslateService and Angular inject imports', (): void => {
		const wrappers: [string, number][] = findWrapperParameters(`
			import { inject } from './dependency-helper';
			import { Inject as UseToken } from '@angular/core';
			import { TranslateService } from './other-service';
			import { TranslateService as NgxTranslator } from '@ngx-translate/core';

			class Labels {
				private readonly field: NgxTranslator = inject(NgxTranslator);
				constructor(private readonly service: TranslateService, @UseToken(TranslateService) private readonly token: NgxTranslator) {}

				translate(key: string): string {
					return this.service.instant(key);
				}

				labelFor(key: string): string {
					return this.field.instant(key);
				}

				explicit(key: string): string {
					return this.token.instant(key);
				}
			}
		`);

		expect(wrappers).toEqual([]);
	});

	it('only records a parameter passed unchanged to instant', (): void => {
		const wrappers: [string, number][] = findWrapperParameters(`
			import { TranslateService } from '@ngx-translate/core';
			const fixedKey = 'APP.FIXED';

			class Labels {
				constructor(private readonly service: TranslateService) {}

				prefixed(key: string): string {
					return this.service.instant('APP.' + key);
				}

				fixed(key: string): string {
					return this.service.instant(fixedKey);
				}

				other(key: string) {
					return this.service.get(key);
				}
			}
		`);

		expect(wrappers).toEqual([]);
	});
});
