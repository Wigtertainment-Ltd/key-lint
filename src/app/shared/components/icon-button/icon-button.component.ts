import { Component, Input } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

@Component({
	selector: 'wig-icon-button',
	templateUrl: './icon-button.component.html',
	imports: [
		TooltipModule,
		ButtonModule
	],
	standalone: true
})
export class WigIconButtonComponent {
	@Input() tooltip: string = null;
	@Input() tooltipPosition: 'right' | 'left' | 'top' | 'bottom' | string | undefined = 'left';
	@Input() loading: boolean = false;
	@Input() disabled: boolean = false;
	@Input() icon: string;
	@Input() text: boolean = true;
	@Input() severity: 'success' | 'info' | 'warning' | 'danger' | 'help' | 'primary' | 'secondary' | 'contrast' | null | undefined = undefined;
}
