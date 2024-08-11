
export type SeverityType = 'success' | 'info' | 'warning' | 'danger';

export abstract class DropdownItem<T> {
	text: string;
	value: T;
	icon: string;
	severity: SeverityType;
}

export class FilterDropdownItem extends DropdownItem<FilterDate> {
}

export enum FilterDate {
	today = 'today',
	currentWeek = 'currentWeek',
	lastWeek = 'lastWeek',
	last30Days = 'last30Days',
	currentMonth = 'currentMonth',
	lastMonth = 'lastMonth',
	currentYear = 'currentYear',
	individuel = 'individuel'
}

export class FilterDateDates {
	from: string;
	to: string;
}

export interface IDateFilterChangedEvent {
	from?: Date;
	to: Date;
}
