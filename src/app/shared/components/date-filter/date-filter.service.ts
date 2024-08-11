import { Injectable } from '@angular/core';
import dayjs from 'dayjs';
import { TranslationService } from '../../services/translation.service';
import { FilterDate, FilterDateDates, FilterDropdownItem } from './date-filter.models';

@Injectable()
export class DateFilterService {
	getFilterQuery(filterOption: FilterDate, fieldName: string, dateRange?: Date | Date[] | undefined): string {
		const dates: FilterDateDates = this.getDates(filterOption);
		if (filterOption === FilterDate.individuel) {
			dates.from = dayjs(dateRange[0]).startOf('day').format('YYYY-MM-DDTHH:mm:ss[Z]');
			dates.to = dayjs(dateRange[1]).startOf('day').format('YYYY-MM-DDTHH:mm:ss[Z]');
		}
		return `${fieldName} >= datetime'${dates.from}' && ${fieldName} <= datetime'${dates.to}'`;
	}

	getCustomDropdownItems(translationService: TranslationService): FilterDropdownItem[] {
		const result: FilterDropdownItem[] = [];
		const values: FilterDate[] = Object.values(FilterDate);
		for (const value of values) {
			result.push(
				{
					text: translationService.instant('GENERIC.ENUMS.FILTERDATE.' + (value as string).toUpperCase()),
					value: value,
					icon: null,
					severity: null
				} as FilterDropdownItem
			);
		}
		return result;
	}

	getDates(value: FilterDate): FilterDateDates {
		let result: FilterDateDates = null;
		const getFirstDayOfWeek = (d): Date => {
			const date: Date = new Date(d);
			const day: number = date.getDay();
			const diff: number = date.getDate() - day + (day === 0 ? -6 : 1);
			return new Date(date.setDate(diff));
		};
		const format: string = 'YYYY-MM-DDTHH:mm:ss[Z]';
		const today: Date = new Date();
		switch (value) {
			case FilterDate.today:
				result = { from: dayjs().startOf('day').format(format), to: dayjs().endOf('day').format(format) };
				break;
			case FilterDate.currentWeek:
				{
					const firstDay: Date = getFirstDayOfWeek(today);
					const lastDay: Date = new Date(firstDay);
					lastDay.setDate(lastDay.getDate() + 6);
					result = { from: dayjs(firstDay).startOf('day').format(format), to: dayjs(lastDay).endOf('day').format(format) };
					break;
				}
			case FilterDate.lastWeek:
				{
					const firstDay: Date = dayjs(getFirstDayOfWeek(today)).subtract(7, 'days').toDate();
					const lastDay: Date = new Date(firstDay);
					lastDay.setDate(lastDay.getDate() + 6);
					result = { from: dayjs(firstDay).startOf('day').format(format), to: dayjs(lastDay).endOf('day').format(format) };
					break;
				}
			case FilterDate.last30Days:
				{
					const firstDay: Date = dayjs().toDate();
					const from1: dayjs.Dayjs = dayjs(firstDay).subtract(30, 'day').startOf('day');
					result = { from: from1.startOf('day').format(format), to: dayjs(firstDay).endOf('day').format(format) };
					break;
				}
			case FilterDate.currentMonth:
				{
					const firstDay: Date = new Date(today.getFullYear(), today.getMonth(), 1);
					const lastDay: Date = new Date(today.getFullYear(), today.getMonth() + 1, 0);
					result = { from: dayjs(firstDay).startOf('day').format(format), to: dayjs(lastDay).endOf('day').format(format) };
					break;
				}
			case FilterDate.lastMonth:
				{
					const firstDay: Date = new Date(today.getFullYear(), today.getMonth() - 1, 1);
					const lastDay: Date = new Date(today.getFullYear(), today.getMonth(), 0);
					result = { from: dayjs(firstDay).startOf('day').format(format), to: dayjs(lastDay).endOf('day').format(format) };
					break;
				}
			case FilterDate.currentYear:
				{
					const firstDay: Date = new Date(today.getFullYear(), 0, 1);
					const lastDay: Date = new Date(today.getFullYear(), 11, 31);
					result = { from: dayjs(firstDay).startOf('day').format(format), to: dayjs(lastDay).endOf('day').format(format) };
					break;
				}
			case FilterDate.individuel:
				{
					result = { from: null, to: null };
					break;
				}
			default:
				break;
		}
		return result;
	}
}
