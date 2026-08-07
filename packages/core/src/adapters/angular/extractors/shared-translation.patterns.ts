import { IPatternDescriptor } from '../../adapter.interfaces.js';

export const SHARED_STATIC_TS_PATTERNS: IPatternDescriptor[] = [
	{
		matchType: 'ts-translate-method',
		regex: /\b(?:this\.)?(?:(?:translate|i18n|transloco)[\w$]*|[A-Za-z_$][\w$]+(?:translate|i18n|transloco)[\w$]*)\s*\.\s*(?:instant|get|stream|translate)\s*\(\s*['"`]([A-Za-z0-9_.-]+)['"`]/gi,
		dynamic: false,
		keyCaptureIndex: 1
	},
	{
		matchType: 'ts-translate-call',
		regex: /\.\s*translate\s*\(/g,
		dynamic: false,
		literalKeyExtraction: true
	},
	{
		matchType: 'ts-indirect-key-literal',
		regex: /['"`]([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+){2,})['"`]/g,
		dynamic: true,
		keyCaptureIndex: 1
	}
];

export const SHARED_DYNAMIC_TS_PATTERNS: IPatternDescriptor[] = [
	{
		matchType: 'ts-dynamic-template-literal',
		regex: /\b(?:this\.)?(?:(?:translate|i18n|transloco)[\w$]*|[A-Za-z_$][\w$]+(?:translate|i18n|transloco)[\w$]*)\s*\.\s*(?:instant|get|stream|translate)\s*\(\s*`([^`]*\$\{[^}]+\}[^`]*)`\s*\)/gi,
		dynamic: true,
		keyCaptureIndex: 1
	},
	{
		matchType: 'ts-dynamic-concat',
		regex: /\b(?:this\.)?(?:(?:translate|i18n|transloco)[\w$]*|[A-Za-z_$][\w$]+(?:translate|i18n|transloco)[\w$]*)\s*\.\s*(?:instant|get|stream|translate)\s*\(\s*([^)\n]*\+[^)\n]*)\)/gi,
		dynamic: true,
		keyCaptureIndex: 1
	}
];
