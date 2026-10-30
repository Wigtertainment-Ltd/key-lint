import { Component, inject, Signal } from '@angular/core';
import { ToastService, IToastMessage } from '../../services/toast.service';

@Component({
	selector: 'app-toast',
	templateUrl: './toast.component.html',
	styleUrl: './toast.component.scss'
})
export class ToastComponent {
	private readonly toastService: ToastService = inject(ToastService);
	readonly message: Signal<IToastMessage | undefined> = this.toastService.message;

	dismiss(): void {
		this.toastService.hide();
	}
}
