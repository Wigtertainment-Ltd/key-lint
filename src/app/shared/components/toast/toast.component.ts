import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { Subscription } from 'rxjs';
import { ToastService, ToastShowEvent } from '../../services/toast.service';

@Component({
	selector: 'wig-toast',
	template: `
		<p-toast key="global" />
	`,
	imports: [
		ToastModule
	],
	providers: [
		MessageService
	],
	standalone: true
})
export class WigToastComponent implements OnInit, OnDestroy {
	constructor(
		private messageService: MessageService,
		private toastService: ToastService
	) { }

	@Input() global: boolean = false;
	subscriptions: Subscription[] = [];

	ngOnInit(): void {
		if (this.global) {
			this.subscriptions.push(
				this.toastService.showToast.subscribe((event: ToastShowEvent) => {
					this.messageService.add({ key: 'global', severity: event.severity, summary: event.title, detail: event.message, sticky: false });
				})
			);
		}
	}

	ngOnDestroy(): void {
		this.subscriptions.forEach((e): void => e.unsubscribe());
	}
}

