import { IPatternDescriptor } from '../../../adapter.interfaces.js';

export const TRANSLOCO_STATIC_HTML_PATTERNS: IPatternDescriptor[] = [
	{
		matchType: 'html-pipe-translate-interpolation',
		description:
			'Matches a static Transloco key in an Angular interpolation and captures the key in group 1.',
		examples: ["{{ 'APP.TITLE' | transloco }}"],
		regex: /\{\{\s*['"`]([A-Za-z0-9_.-]+)['"`]\s*\|\s*transloco\b[^\n]*?\}\}/g,
		dynamic: false,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-pipe-translate-binding',
		description:
			'Matches a static Transloco key piped inside a quoted Angular binding and captures the key in group 1.',
		examples: ["[title]=\"'APP.TITLE' | transloco\""],
		regex: /=\s*['"]\s*['"`]([A-Za-z0-9_.-]+)['"`]\s*\|\s*transloco\b[^'"\n]*['"]/g,
		dynamic: false,
		keyCaptureIndex: 1
	}
];

export const TRANSLOCO_DYNAMIC_PATTERNS: IPatternDescriptor[] = [
	{
		matchType: 'html-dynamic-pipe-concat-interpolation',
		description:
			'Matches a concatenated Transloco pipe expression in an interpolation and captures the expression in group 1.',
		examples: ["{{ 'APP.' + section | transloco }}"],
		regex: /\{\{\s*([^}\n]*\+[^}\n]*?)\s*\|\s*transloco\b[^}]*\}\}/g,
		dynamic: true,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-dynamic-pipe-concat-binding',
		description:
			'Matches a concatenated Transloco pipe expression in a quoted binding; group 1 is the quote and group 2 is the expression.',
		examples: ["[title]=\"'APP.' + section | transloco\""],
		regex: /=\s*(['"])\s*([^\n]*\+[^\n]*?)\s*\|\s*transloco\b[^\n]*?\1/g,
		dynamic: true,
		keyCaptureIndex: 2
	},
	{
		matchType: 'html-dynamic-pipe-template-literal',
		description:
			'Matches a template literal with interpolation passed through the Transloco pipe and captures it in group 1.',
		examples: ['[title]="`APP.${section}` | transloco"'],
		regex: /=\s*['"]\s*(`[^`]*\$\{[^}]+\}[^`]*`)\s*\|\s*transloco\b[^'"\n]*['"]/g,
		dynamic: true,
		keyCaptureIndex: 1
	}
];
