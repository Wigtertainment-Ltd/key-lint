import { IPatternDescriptor } from '../../../adapter.interfaces.js';

export const NGX_STATIC_HTML_PATTERNS: IPatternDescriptor[] = [
	{
		matchType: 'html-pipe-translate-interpolation',
		regex: /\{\{\s*['"`]([A-Za-z0-9_.-]+)['"`]\s*\|\s*translate\b[^}]*\}\}/g,
		dynamic: false,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-pipe-translate-binding',
		regex: /=\s*['"]\s*['"`]([A-Za-z0-9_.-]+)['"`]\s*\|\s*translate\b[^'"\n]*['"]/g,
		dynamic: false,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-attribute-translate',
		regex: /\btranslate\s*=\s*['"]([A-Za-z0-9_.-]+)['"]/g,
		dynamic: false,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-bound-translate',
		regex: /\[translate\]\s*=\s*['"]\s*['"`]([A-Za-z0-9_.-]+)['"`]\s*['"]/g,
		dynamic: false,
		keyCaptureIndex: 1
	}
];

export const NGX_DYNAMIC_PATTERNS: IPatternDescriptor[] = [
	{
		matchType: 'html-dynamic-translate-binding',
		regex: /\[translate\]\s*=\s*['"]([^'"\n]*\+[^'"\n]*)['"]/g,
		dynamic: true,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-dynamic-pipe-concat-interpolation',
		regex: /\{\{\s*([^}\n]*\+[^}\n]*?)\s*\|\s*translate\b[^}]*\}\}/g,
		dynamic: true,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-dynamic-pipe-concat-binding',
		regex: /=\s*(['"])\s*([^\n]*\+[^\n]*?)\s*\|\s*translate\b[^\n]*?\1/g,
		dynamic: true,
		keyCaptureIndex: 2
	},
	{
		matchType: 'html-dynamic-pipe-template-literal',
		regex: /=\s*['"]\s*(`[^`]*\$\{[^}]+\}[^`]*`)\s*\|\s*translate\b[^'"\n]*['"]/g,
		dynamic: true,
		keyCaptureIndex: 1
	}
];
