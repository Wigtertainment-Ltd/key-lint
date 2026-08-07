import { IPatternDescriptor } from '../../../adapter.interfaces.js';

export const TRANSLOCO_STATIC_HTML_PATTERNS: IPatternDescriptor[] = [
	{
		matchType: 'html-pipe-translate-interpolation',
		regex: /\{\{\s*['"`]([A-Za-z0-9_.-]+)['"`]\s*\|\s*transloco\b[^}]*\}\}/g,
		dynamic: false,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-pipe-translate-binding',
		regex: /=\s*['"]\s*['"`]([A-Za-z0-9_.-]+)['"`]\s*\|\s*transloco\b[^'"\n]*['"]/g,
		dynamic: false,
		keyCaptureIndex: 1
	}
];

export const TRANSLOCO_DYNAMIC_PATTERNS: IPatternDescriptor[] = [
	{
		matchType: 'html-dynamic-pipe-concat-interpolation',
		regex: /\{\{\s*([^}\n]*\+[^}\n]*?)\s*\|\s*transloco\b[^}]*\}\}/g,
		dynamic: true,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-dynamic-pipe-concat-binding',
		regex: /=\s*(['"])\s*([^\n]*\+[^\n]*?)\s*\|\s*transloco\b[^\n]*?\1/g,
		dynamic: true,
		keyCaptureIndex: 2
	},
	{
		matchType: 'html-dynamic-pipe-template-literal',
		regex: /=\s*['"]\s*(`[^`]*\$\{[^}]+\}[^`]*`)\s*\|\s*transloco\b[^'"\n]*['"]/g,
		dynamic: true,
		keyCaptureIndex: 1
	}
];
