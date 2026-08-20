import { IPatternDescriptor } from '../../adapter.interfaces.js';

export const SHARED_STATIC_TS_PATTERNS: IPatternDescriptor[] = [
	{
		matchType: 'ts-translate-method',
		description:
			'Matches a static key passed to a supported translation service method and captures the key in group 1.',
		examples: ["this.translateService.instant('APP.TITLE')"],
		regex: /\b(?:this\.)?(?:(?:translate|i18n|transloco)[\w$]*|[A-Za-z_$][\w$]+(?:translate|i18n|transloco)[\w$]*)\s*\.\s*(?:instant|get|stream|translate)\s*\(\s*['"`]([A-Za-z0-9_.-]+)['"`]/gi,
		dynamic: false,
		keyCaptureIndex: 1
	},
	{
		matchType: 'ts-translate-call',
		description:
			'Matches any member translate call so its first argument can be parsed separately for literal keys.',
		examples: ["languageService.translate('APP.TITLE')"],
		regex: /\.\s*translate\s*\(/g,
		dynamic: false,
		literalKeyExtraction: true
	},
	{
		matchType: 'ts-indirect-key-literal',
		description:
			'Matches a quoted, dot-separated key with at least three segments and captures the complete key in group 1.',
		examples: ["const key = 'APP.NAV.TITLE';"],
		regex: /['"`]([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+){2,})['"`]/g,
		dynamic: true,
		keyCaptureIndex: 1
	}
];

export const SHARED_DYNAMIC_TS_PATTERNS: IPatternDescriptor[] = [
	{
		matchType: 'ts-dynamic-template-literal',
		description:
			'Matches a supported translation method called with a template literal containing interpolation and captures its contents in group 1.',
		examples: ['this.translateService.instant(`APP.${section}`)'],
		regex: /\b(?:this\.)?(?:(?:translate|i18n|transloco)[\w$]*|[A-Za-z_$][\w$]+(?:translate|i18n|transloco)[\w$]*)\s*\.\s*(?:instant|get|stream|translate)\s*\(\s*`([^`]*\$\{[^}]+\}[^`]*)`\s*\)/gi,
		dynamic: true,
		keyCaptureIndex: 1
	},
	{
		matchType: 'ts-dynamic-concat',
		description:
			'Matches a supported translation method called with a concatenated expression and captures the expression in group 1.',
		examples: ["this.translateService.instant('APP.' + section)"],
		regex: /\b(?:this\.)?(?:(?:translate|i18n|transloco)[\w$]*|[A-Za-z_$][\w$]+(?:translate|i18n|transloco)[\w$]*)\s*\.\s*(?:instant|get|stream|translate)\s*\(\s*([^)\n]*\+[^)\n]*)\)/gi,
		dynamic: true,
		keyCaptureIndex: 1
	}
];
