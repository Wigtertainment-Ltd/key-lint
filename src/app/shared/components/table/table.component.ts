import { CommonModule } from '@angular/common';
import { Component, ContentChildren, EventEmitter, Input, Output, QueryList, TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MenuItem } from 'primeng/api';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SplitButtonModule } from 'primeng/splitbutton';
import { TableLazyLoadEvent, TableModule, TableRowSelectEvent } from 'primeng/table';
import { EuroPipe } from '../../pipes/euro.pipe';
import { WigButtonComponent } from '../button/button.component';
import { WigIconButtonComponent } from '../icon-button/icon-button.component';

@Component({
	selector: 'wig-table',
	templateUrl: './table.component.html',
	styleUrl: './table.component.scss',
	imports: [
		CommonModule, EuroPipe, TableModule, SplitButtonModule, WigButtonComponent, WigIconButtonComponent, InputIconModule, IconFieldModule, InputTextModule, FormsModule
	],
	standalone: true
})
export class WigTableComponent<T> {
	@Input() withSearch: boolean = false;
	@Input() loading: boolean = false;
	@Input() insideCard: boolean = true;
	@Input() data: T[] = [];
	@Input() totalCount: number;
	@Input() config: TableConfig<T>;
	@Input() lazyLoading: boolean = false;
	@Input() paging: boolean = false;
	@Input() pageSize: number = 10;
	@Output() onRowSelected: EventEmitter<ITableRowSelectedEvent<T>> = new EventEmitter();
	@Output() onLazyLoadData: EventEmitter<SearchParams> = new EventEmitter();
	maxPageSize: number = 1000000;
	searchTerm: string;
	@ContentChildren(TemplateRef) set customColumns(val: QueryList<TemplateRef<unknown>>) {
		this._customColumns = val;
	}
	private _customColumns: QueryList<TemplateRef<unknown>>;

	rowSelected(item: TableRowSelectEvent): void {
		this.onRowSelected.emit(item as ITableRowSelectedEvent<T>);
	}

	getSplitButtonDropDownItem(event: Event, splitConfig: TableActionSplitButtonConfig, item: unknown): void {
		event.stopPropagation();
		splitConfig.dropDownButtons = splitConfig.getDropDownItems(item);
	}

	btnClicked(event: Event, action: TableActionConfig, item: unknown): void {
		event.stopPropagation();
		action.onClick(item);
	}

	tableActionIsVisible(action: TableActionConfig, item: unknown): boolean {
		return action.isVisible ? action.isVisible(item) : true;
	}

	getTemplate(template: string): TemplateRef<unknown> {
		return this._customColumns.find(item => (item as any)._declarationTContainer?.localNames?.[0] === template);
	}

	loadData(event: TableLazyLoadEvent): void {
		if (this.data.length !== 0) {
			const sort: string = event.sortField ? `${event.sortField} ${event.sortOrder > 0 ? 'asc' : 'desc'}` : undefined;
			this.onLazyLoadData.emit(new SearchParams(event.first, event.rows, sort));
		}
	}

	search(event: unknown): void {
		// eslint-disable-next-line no-console
		console.log(event);
	}
}

export class TableConfig<T> {
	columns: TableColumnConfig<T>[];
	actions?: TableActionConfig[];
}

export class TableColumnConfig<T> {
	field: keyof T & string;
	text: string;
	type: 'image' | 'currency' | 'text' | 'date' | 'custom';
	imageConfig?: TableImageColumnConfig;
	dateConfig?: { format: string };
	sortable?: boolean = false;
	template?: string;
}

export class TableImageColumnConfig {
	alt: string;
	width?: string;
	height?: string;
	maxWidth?: string;
	maxHeight?: string;
}

export class TableActionConfig {
	type: 'button' | 'iconButton' | 'splitButton' | 'dropDown';
	icon?: string;
	text?: string;
	onClick: (item: unknown) => void;
	isVisible?: (item: unknown) => boolean;
	splitButtonConfig?: TableActionSplitButtonConfig;
}

export class TableActionSplitButtonConfig {
	// onDropdownClick: () => void;
	getDropDownItems: (item: unknown) => MenuItem[];
	dropDownButtons?: MenuItem[];
}

export interface ITableRowSelectedEvent<T> {
	data: T;
	index: number,
	originalEvent: PointerEvent;
	type: string;
}

export class SearchParams {
	constructor(skip: number = 0, take: number = 10, order?: string, searchQuery?: string) {
		this.skip = skip;
		this.take = take;
		this.order = order;
		this.searchQuery = searchQuery;
	}

	skip: number;
	take: number;
	order: string;
	searchQuery: string;

	getSearchQuery(): string {
		let result: string = '';
		if (this.searchQuery) {
			result += `${this.searchQuery} `;
		}
		if (this.order) {
			result += `orderby ${this.order} `;
		}
		if (this.skip !== undefined) {
			result += `skip ${this.skip} top ${this.take} `;
		}
		return `searchQuery=${encodeURIComponent(result.trim())}`;
	}
}
