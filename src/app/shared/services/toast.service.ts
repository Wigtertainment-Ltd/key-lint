import { EventEmitter, Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ToastService {

	showToast: EventEmitter<ToastShowEvent> = new EventEmitter();

	info(title: string, message: string): void {
		this.showToast.emit({ severity: 'info', title: title, message: message });
	}

	success(titleKey: string, messageKey: string): void {
		this.showToast.emit({ severity: 'success', title: titleKey, message: messageKey });
	}

	error(titleKey: string, messageKey: string): void {
		this.showToast.emit({ severity: 'error', title: titleKey, message: messageKey });
	}
}

export class ToastShowEvent {
	severity!: string;
	title!: string;
	message!: string;
}
