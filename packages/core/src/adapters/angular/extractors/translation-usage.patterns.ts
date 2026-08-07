import { IPatternDescriptor } from '../../adapter.interfaces.js';
import { NGX_DYNAMIC_PATTERNS, NGX_STATIC_HTML_PATTERNS } from './ngx-translate/ngx-translate.patterns.js';
import { SHARED_DYNAMIC_TS_PATTERNS, SHARED_STATIC_TS_PATTERNS } from './shared-translation.patterns.js';
import { TRANSLOCO_DYNAMIC_PATTERNS, TRANSLOCO_STATIC_HTML_PATTERNS } from './transloco/transloco.patterns.js';

export const STATIC_HTML_PATTERNS: IPatternDescriptor[] = [
	...NGX_STATIC_HTML_PATTERNS,
	...TRANSLOCO_STATIC_HTML_PATTERNS
];

export const STATIC_TS_PATTERNS: IPatternDescriptor[] = [...SHARED_STATIC_TS_PATTERNS];

export const DYNAMIC_PATTERNS: IPatternDescriptor[] = [
	...SHARED_DYNAMIC_TS_PATTERNS,
	...NGX_DYNAMIC_PATTERNS,
	...TRANSLOCO_DYNAMIC_PATTERNS
];
