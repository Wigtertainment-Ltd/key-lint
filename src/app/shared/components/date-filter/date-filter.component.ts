import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import dayjs from 'dayjs';
import { DropdownModule } from 'primeng/dropdown';
import { LoggerService } from '../../services';
import { TranslationService } from '../../services/translation.service';
import { WigCalendarComponent } from '../calendar/calendar.component';
import { FilterDate, FilterDateDates, FilterDropdownItem, IDateFilterChangedEvent } from './date-filter.models';
import { DateFilterService } from './date-filter.service';

const CLASSNAME: string = 'BroDateFilterComponent';

@Component({
	standalone: true,
	imports: [FormsModule, DropdownModule, WigCalendarComponent, TranslateModule],
	providers: [DateFilterService],
	selector: 'wig-date-filter',
	templateUrl: './date-filter.component.html'
})
export class WigDateFilterComponent implements OnInit {
	constructor(
		private readonly loggerService: LoggerService,
		private readonly dateFilterService: DateFilterService,
		private readonly translationService: TranslationService
	) { }

	@Input() isLoading: boolean = false;
	@Input() fieldName: string;
	@Output() dateRangeChanged: EventEmitter<IDateFilterChangedEvent> = new EventEmitter();
	filterOptions: FilterDropdownItem[] = [];
	selectedFilterDropDown: FilterDropdownItem;
	selectedFilterOption: FilterDate;
	FILTERDATE: typeof FilterDate = FilterDate;
	dateRange: Date[] = [new Date(), new Date()];

	ngOnInit(): void {
		this.filterOptions = this.dateFilterService.getCustomDropdownItems(this.translationService);
		this.selectedFilterOption = FilterDate.currentYear;
		this.selectedFilterDropDown = this.filterOptions.find(f => f.value === this.selectedFilterOption);
		this.changed();
	}

	filterChanged(filter: FilterDate): void {
		this.loggerService.debug(CLASSNAME + '.filterChanged', filter);
		this.selectedFilterDropDown = this.filterOptions.find(f => f.value === filter);
		this.changed();
	}

	dateChanged(dateRange: Date | Date[] | undefined): void {
		if (dateRange && dateRange instanceof Array && dateRange.length === 2 && dateRange[0] && dateRange[1]) {
			this.dateRange = dateRange;
			this.changed();
		}
	}

	getFilterQuery(): string {
		return this.dateFilterService.getFilterQuery(this.selectedFilterOption, this.fieldName, this.dateRange);
	}

	getDates(): IDateFilterChangedEvent {
		const dates: FilterDateDates = this.dateFilterService.getDates(this.selectedFilterOption);
		if (this.selectedFilterOption === FilterDate.individuel) {
			dates.from = dayjs(this.dateRange[0]).startOf('day').format('YYYY-MM-DD');
			dates.to = dayjs(this.dateRange[1]).startOf('day').format('YYYY-MM-DD');
		}
		return { from: new Date(dates.from), to: new Date(dates.to) };
	}

	private changed(): void {
		const event: IDateFilterChangedEvent = this.getDates();
		this.dateRangeChanged.emit(event);
	}
}
