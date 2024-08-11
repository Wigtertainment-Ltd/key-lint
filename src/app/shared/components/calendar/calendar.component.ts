import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CalendarModule } from 'primeng/calendar';

@Component({
	standalone: true,
	imports: [FormsModule, CalendarModule],
	selector: 'wig-calendar',
	templateUrl: './calendar.component.html'
})
export class WigCalendarComponent {
	@Input() selectionMode: 'single' | 'multiple' | 'range' | undefined = 'single';
	@Input() date: Date | Date[] | undefined;
	@Output() dateChange: EventEmitter<Date | Date[] | undefined> = new EventEmitter();

	onDateChanged(): void {
		this.dateChange.emit(this.date);
	}
}
