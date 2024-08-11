import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
	selector: 'wig-card',
	imports: [CommonModule],
	standalone: true,
	templateUrl: './card.component.html',
	styleUrls: ['./card.component.scss']
})
export class WigCardComponent {
	@Input() header: string = '';
}
