#!/usr/bin/env node
import { runCli } from './cli.js';

const exitCode: number = await runCli(process.argv.slice(2));
process.exitCode = exitCode;
