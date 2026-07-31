import { Injectable, signal } from '@angular/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'log';

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	log: 2,
	warn: 3,
	error: 4,
};

@Injectable({ providedIn: 'root' })
export class LoggerService {
	private readonly level = signal<LogLevel>('info');

	/** Set the minimum log level. Only logs at this level or higher will be output. */
	setLevel(level: LogLevel): void {
		this.level.set(level);
	}

	getLevel(): LogLevel {
		return this.level();
	}

	private shouldLog(level: LogLevel): boolean {
		return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level()];
	}

	private format(prefix: string, message: string, levelLabel: string): string {
		const timestamp = new Date().toISOString();
		return `[${timestamp}] [${levelLabel}] [${prefix}] ${message}`;
	}

	debug(prefix: string, message: string, ...args: unknown[]): void {
		if (this.shouldLog('debug')) console.debug(this.format(prefix, message, 'DEBUG'), ...args);
	}

	info(prefix: string, message: string, ...args: unknown[]): void {
		if (this.shouldLog('info')) console.info(this.format(prefix, message, 'INFO'), ...args);
	}

	log(prefix: string, message: string, ...args: unknown[]): void {
		if (this.shouldLog('log')) console.log(this.format(prefix, message, 'LOG'), ...args);
	}

	warn(prefix: string, message: string, ...args: unknown[]): void {
		if (this.shouldLog('warn')) console.warn(this.format(prefix, message, 'WARN'), ...args);
	}

	error(prefix: string, message: string, ...args: unknown[]): void {
		if (this.shouldLog('error')) console.error(this.format(prefix, message, 'ERROR'), ...args);
	}
}
