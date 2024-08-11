import { Component, Input } from '@angular/core';
import { ButtonModule } from 'primeng/button';

@Component({
	selector: 'wig-button',
	templateUrl: './button.component.html',
	standalone: true,
	imports: [ButtonModule],
})
export class WigButtonComponent {
	@Input() loading: boolean = false;
	@Input() disabled: boolean = false;
	@Input() styleClass?: string;
	@Input() label: string = '';
	@Input() icon?: string;
	@Input() size: 'small' | 'large' = 'small';
	@Input() text: boolean = false;
	@Input() link: boolean = false;
	@Input() rounded: boolean = false;
	@Input() severity?: 'secondary' | 'success' | 'info' | 'warning' | 'help' | 'danger' = undefined;
}
