// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

const typeScriptRules = {
	'@typescript-eslint/explicit-function-return-type': [
		'error',
		{
			allowExpressions: true,
			allowHigherOrderFunctions: true
		}
	],
	'@typescript-eslint/explicit-module-boundary-types': 'error',
	'@typescript-eslint/no-explicit-any': 'error',
	'@typescript-eslint/no-inferrable-types': 'off',
	// Adapter contracts intentionally expose async methods even when an implementation can resolve synchronously.
	'@typescript-eslint/require-await': 'off'
};

const typeCheckedLanguageOptions = {
	parserOptions: {
		projectService: true,
		tsconfigRootDir: __dirname
	}
};

module.exports = defineConfig([
	{
		ignores: ['dist/**', 'coverage/**', 'node_modules/**']
	},
	{
		files: ['packages/core/src/**/*.ts', 'packages/cli/src/**/*.ts'],
		ignores: ['**/*.spec.ts'],
		extends: [eslint.configs.recommended, tseslint.configs.recommendedTypeChecked, tseslint.configs.stylistic],
		languageOptions: typeCheckedLanguageOptions,
		rules: typeScriptRules
	},
	{
		files: ['src/**/*.ts'],
		ignores: ['**/*.spec.ts'],
		extends: [
			eslint.configs.recommended,
			tseslint.configs.recommendedTypeChecked,
			tseslint.configs.stylistic,
			angular.configs.tsRecommended
		],
		languageOptions: typeCheckedLanguageOptions,
		processor: angular.processInlineTemplates,
		rules: {
			...typeScriptRules,
			'@angular-eslint/prefer-inject': 'off',
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
		files: ['packages/core/src/**/*.spec.ts', 'packages/cli/src/**/*.spec.ts', 'src/**/*.spec.ts'],
		extends: [eslint.configs.recommended, tseslint.configs.strict, tseslint.configs.stylistic],
		rules: {
			...typeScriptRules,
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
