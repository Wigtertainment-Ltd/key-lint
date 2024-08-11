/* eslint-disable no-console */
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ToastService } from './toast.service';

@Injectable({ providedIn: 'root' })
export class LoggerService {
	constructor(private toastService: ToastService) { }

	log(message: string, ...args: unknown[]): void {
		console.log(message, ...args);
	}

	debug(message: string, ...args: unknown[]): void {
		console.debug(message, ...args);
	}

	error(message: string, ...args: unknown[]): void {
		console.error(message, ...args);
	}

	errorWithToast(message: string, ...args: unknown[]): void {
		this.error(message, ...args);
		if (args[0] instanceof HttpErrorResponse && args[0].error?.message) {
			this.toastService.error(message, args[0].error.message);
		}
		else {
			this.toastService.error(message, 'Unfortunately, an error occurred. Please try again later.');
		}
	}
}
