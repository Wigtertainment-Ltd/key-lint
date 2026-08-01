import { Component, inject } from '@angular/core';
import { ToastService } from '../../services/toast.service';

@Component({
	selector: 'app-toast',
	templateUrl: './toast.component.html',
	styleUrl: './toast.component.scss'
})
export class ToastComponent {
	private readonly toastService = inject(ToastService);
	readonly message = this.toastService.message;

	dismiss(): void {
		this.toastService.hide();
	}
}
