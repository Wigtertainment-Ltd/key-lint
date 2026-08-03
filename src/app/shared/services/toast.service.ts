import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info';

export interface IToastMessage {
	id: number;
	type: ToastType;
	text: string;
}

@Injectable({
	providedIn: 'root'
})
export class ToastService {
	private readonly messageSignal = signal<IToastMessage | undefined>(undefined);
	private timer?: ReturnType<typeof setTimeout>;
	private nextId = 0;

	readonly message = this.messageSignal.asReadonly();

	success(text: string, durationMs = 2500): void {
		this.show('success', text, durationMs);
	}

	error(text: string, durationMs = 3200): void {
		this.show('error', text, durationMs);
	}

	info(text: string, durationMs = 2500): void {
		this.show('info', text, durationMs);
	}

	hide(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}

		this.messageSignal.set(undefined);
	}

	private show(type: ToastType, text: string, durationMs: number): void {
		this.hide();
		this.messageSignal.set({
			id: ++this.nextId,
			type,
			text
		});

		if (durationMs > 0) {
			this.timer = setTimeout(() => {
				this.messageSignal.set(undefined);
				this.timer = undefined;
			}, durationMs);
		}
	}
}
