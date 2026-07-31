import { Injector } from '@angular/core';
import { LoggerService } from './logger.service';

let _injector: Injector | null = null;

/**
 * Register the root injector so the static logger can access LoggerService via DI.
 * Call this once in app.config.ts or bootstrapApplication.
 */
export function setLoggerInjector(injector: Injector): void {
	_injector = injector;
}

function getService(): LoggerService | null {
	if (_injector) {
		try {
			return _injector.get(LoggerService, null);
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Lightweight logger that works everywhere — in Angular DI context and outside.
 * Falls back to direct console calls when no LoggerService is available.
 */
export const logger = {
	debug(prefix: string, message: string, ...args: unknown[]): void {
		const svc = getService();
		if (svc) {
			svc.debug(prefix, message, ...args);
		} else {
			console.debug(`[DEBUG] [${prefix}] ${message}`, ...args);
		}
	},

	info(prefix: string, message: string, ...args: unknown[]): void {
		const svc = getService();
		if (svc) {
			svc.info(prefix, message, ...args);
		} else {
			console.info(`[INFO] [${prefix}] ${message}`, ...args);
		}
	},

	log(prefix: string, message: string, ...args: unknown[]): void {
		const svc = getService();
		if (svc) {
			svc.log(prefix, message, ...args);
		} else {
			console.log(`[LOG] [${prefix}] ${message}`, ...args);
		}
	},

	warn(prefix: string, message: string, ...args: unknown[]): void {
		const svc = getService();
		if (svc) {
			svc.warn(prefix, message, ...args);
		} else {
			console.warn(`[WARN] [${prefix}] ${message}`, ...args);
		}
	},

	error(prefix: string, message: string, ...args: unknown[]): void {
		const svc = getService();
		if (svc) {
			svc.error(prefix, message, ...args);
		} else {
			console.error(`[ERROR] [${prefix}] ${message}`, ...args);
		}
	},
};
