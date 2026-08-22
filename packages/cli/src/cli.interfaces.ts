import { ReporterName } from './reporters/reporter.interfaces.js';

export interface ICliOptions {
	command: 'scan' | 'help' | 'version';
	projectPath: string;
	configPath?: string;
	reporters: ReporterName[];
	/** Reporter name -> output file. Reporters without an entry write to stdout. */
	outputs: Map<ReporterName, string>;
	maxErrors: number;
	/** Negative means "unlimited". */
	maxWarnings: number;
	ignoreKeys: string[];
	allowNetwork: boolean;
	quiet: boolean;
	color: boolean;
}

export class CliUsageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CliUsageError';
	}
}

export interface ICliIo {
	stdout(text: string): void;
	stderr(text: string): void;
	writeFile(filePath: string, content: string): Promise<void>;
}
