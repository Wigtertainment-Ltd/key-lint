import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DropdownModule } from 'primeng/dropdown';

@Component({
	selector: 'wig-dropdown',
	templateUrl: './dropdown.component.html',
	imports: [FormsModule, DropdownModule],
	standalone: true
})
export class WigDropdownComponent<T> {

	@Input() optionLabel!: string;
	@Input() optionValue!: string;
	@Input() placeholder: string = 'Select a Option';
	@Input() options: T[] = [];
	@Input() selectedOption?: T;
	@Output() selectedOptionChange: EventEmitter<T> = new EventEmitter();

}
