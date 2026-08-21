import { IPatternDescriptor } from '../../../adapter.interfaces.js';

export const NGX_STATIC_HTML_PATTERNS: IPatternDescriptor[] = [
	{
		matchType: 'html-pipe-translate-interpolation',
		description:
			'Matches a static ngx-translate key in an Angular interpolation and captures the key in group 1.',
		examples: ["{{ 'APP.TITLE' | translate }}"],
		regex: /\{\{\s*['"`]([A-Za-z0-9_.-]+)['"`]\s*\|\s*translate\b[^\n]*?\}\}/g,
		dynamic: false,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-pipe-translate-binding',
		description:
			'Matches a static ngx-translate key piped inside a quoted Angular binding and captures the key in group 1.',
		examples: ["[title]=\"'APP.TITLE' | translate\""],
		regex: /=\s*['"]\s*['"`]([A-Za-z0-9_.-]+)['"`]\s*\|\s*translate\b[^'"\n]*['"]/g,
		dynamic: false,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-attribute-translate',
		description:
			'Matches a static key assigned directly to the ngx-translate attribute and captures the key in group 1.',
		examples: ['<div translate="APP.TITLE"></div>'],
		regex: /\btranslate\s*=\s*['"]([A-Za-z0-9_.-]+)['"]/g,
		dynamic: false,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-bound-translate',
		description:
			'Matches a quoted static key assigned to the bound ngx-translate input and captures the key in group 1.',
		examples: ["<div [translate]=\"'APP.TITLE'\"></div>"],
		regex: /\[translate\]\s*=\s*['"]\s*['"`]([A-Za-z0-9_.-]+)['"`]\s*['"]/g,
		dynamic: false,
		keyCaptureIndex: 1
	}
];

export const NGX_DYNAMIC_PATTERNS: IPatternDescriptor[] = [
	{
		matchType: 'html-dynamic-translate-binding',
		description:
			'Matches a concatenated expression assigned to the bound ngx-translate input and captures the expression in group 1.',
		examples: ['<div [translate]="prefix + section"></div>'],
		regex: /\[translate\]\s*=\s*['"]([^'"\n]*\+[^'"\n]*)['"]/g,
		dynamic: true,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-dynamic-pipe-concat-interpolation',
		description:
			'Matches a concatenated ngx-translate pipe expression in an interpolation and captures the expression in group 1.',
		examples: ["{{ 'APP.' + section | translate }}"],
		regex: /\{\{\s*([^}\n]*\+[^}\n]*?)\s*\|\s*translate\b[^}]*\}\}/g,
		dynamic: true,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-dynamic-pipe-concat-binding',
		description:
			'Matches a concatenated ngx-translate pipe expression in a quoted binding; group 1 is the quote and group 2 is the expression.',
		examples: ["[title]=\"'APP.' + section | translate\""],
		regex: /=\s*(['"])\s*([^\n]*\+[^\n]*?)\s*\|\s*translate\b[^\n]*?\1/g,
		dynamic: true,
		keyCaptureIndex: 2
	},
	{
		matchType: 'html-dynamic-pipe-template-literal',
		description:
			'Matches a template literal with interpolation passed through the ngx-translate pipe and captures it in group 1.',
		examples: ['[title]="`APP.${section}` | translate"'],
		regex: /=\s*['"]\s*(`[^`]*\$\{[^}]+\}[^`]*`)\s*\|\s*translate\b[^'"\n]*['"]/g,
		dynamic: true,
		keyCaptureIndex: 1
	}
];
