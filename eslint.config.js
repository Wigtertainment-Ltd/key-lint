// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const stylistic = require('@stylistic/eslint-plugin');

const typeScriptRules = {
	'@typescript-eslint/explicit-module-boundary-types': 'error',
	'@typescript-eslint/no-explicit-any': 'error',
	curly: ['error', 'all'],
	'@stylistic/curly-newline': ['error', {
		consistent: true,
		IfStatementConsequent: 'always',
		IfStatementAlternative: 'always',
		ForStatement: 'always',
		ForInStatement: 'always',
		ForOfStatement: 'always',
		WhileStatement: 'always',
		DoWhileStatement: 'always'
	}],
	'@typescript-eslint/explicit-function-return-type': ['error', {
		allowExpressions: false,
		allowHigherOrderFunctions: false,
		allowTypedFunctionExpressions: false,
		allowDirectConstAssertionInArrowFunctions: false
	}],
	'@typescript-eslint/typedef': ['error', {
		arrayDestructuring: true,
		arrowParameter: true,
		memberVariableDeclaration: true,
		objectDestructuring: true,
		parameter: true,
		propertyDeclaration: true,
		variableDeclaration: true,
		variableDeclarationIgnoreFunction: false
	}],
	// Explicit annotations are required even when TypeScript can infer the type.
	'@typescript-eslint/no-inferrable-types': 'off',
	'no-restricted-syntax': ['error', {
		selector: 'CatchClause[param.type="Identifier"]:not([param.typeAnnotation])',
		message: 'Catch variables must have an explicit unknown type annotation.'
	}],
	'@typescript-eslint/require-await': 'error'
};

const typeCheckedLanguageOptions = {
	parserOptions: {
		project: ['./tsconfig.eslint.json'],
		tsconfigRootDir: __dirname
	}
};

module.exports = defineConfig([
	{
		ignores: ['dist/**', 'coverage/**', 'node_modules/**']
	},
	{
		files: ['packages/core/src/**/*.ts', 'packages/core/test/jasmine-matchers.ts', 'packages/cli/src/**/*.ts'],
		extends: [eslint.configs.recommended, tseslint.configs.recommendedTypeChecked, tseslint.configs.stylisticTypeChecked],
		languageOptions: {
			parserOptions: {
				project: ['./packages/core/tsconfig.eslint.json', './packages/cli/tsconfig.eslint.json'],
				tsconfigRootDir: __dirname
			}
		},
		linterOptions: { reportUnusedDisableDirectives: 'error' },
		plugins: { '@stylistic': stylistic },
		rules: typeScriptRules
	},
	{
		files: ['packages/core/src/**/*.spec.ts', 'packages/cli/src/**/*.spec.ts'],
		extends: [tseslint.configs.strict],
		rules: {
			// Test setup may assert a fixture invariant after arranging the corresponding value.
			'@typescript-eslint/no-non-null-assertion': 'off'
		}
	},
	{
		files: ['src/**/*.ts'],
		extends: [
			eslint.configs.recommended,
			tseslint.configs.recommendedTypeChecked,
			tseslint.configs.stylisticTypeChecked,
			angular.configs.tsRecommended
		],
		languageOptions: typeCheckedLanguageOptions,
		linterOptions: { reportUnusedDisableDirectives: 'error' },
		plugins: { '@stylistic': stylistic },
		processor: angular.processInlineTemplates,
		rules: {
			...typeScriptRules,
			'@angular-eslint/use-lifecycle-interface': 'error',
			'@angular-eslint/directive-selector': [
				'error',
				{
					type: 'attribute',
					prefix: 'app',
					style: 'camelCase'
				}
			],
			'@angular-eslint/component-selector': [
				'error',
				{
					type: 'element',
					prefix: 'app',
					style: 'kebab-case'
				}
			]
		}
	},
	{
		files: ['src/**/*.spec.ts'],
		extends: [tseslint.configs.strict],
		rules: {
			// Test setup may assert a fixture invariant after arranging the corresponding value.
			'@typescript-eslint/no-non-null-assertion': 'off'
		}
	},
	{
		files: ['src/**/*.html'],
		extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
		rules: {}
	}
]);
