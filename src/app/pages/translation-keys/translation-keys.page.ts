import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
	ProjectScanResult,
	TranslationMatrix,
	TranslationMatrixRow
} from '../../core/models/scan-result.model';
import { ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';

@Component({
	selector: 'app-translation-keys-page',
	standalone: true,
	templateUrl: './translation-keys.page.html',
	styleUrl: './translation-keys.page.scss'
})
export class TranslationKeysPage implements OnInit, OnDestroy {
	scanResult?: ProjectScanResult;
	activeFilter: 'all' | 'missing' = 'all';
	searchTerm = '';
	selectedKey?: string;
	isDetailOpen = false;
	keyCopied = false;
	private stateSubscription?: Subscription;

	constructor(
		private readonly scanOrchestrationService: ScanOrchestrationService,
		private readonly router: Router
	) {}

	ngOnInit(): void {
		this.scanResult = this.scanOrchestrationService.snapshot.result;
		this.ensureSelectedRow();
		this.stateSubscription = this.scanOrchestrationService.state$.subscribe((snapshot) => {
			if (snapshot.result) {
				this.scanResult = snapshot.result;
				this.ensureSelectedRow();
			}
		});

		if (!this.scanResult) {
			void this.router.navigate(['/scan-progress']);
		}
	}

	ngOnDestroy(): void {
		this.stateSubscription?.unsubscribe();
	}

	onSearchChange(value: string): void {
		this.searchTerm = value;
		this.ensureSelectedRow();
	}

	onFilterChange(filter: 'all' | 'missing'): void {
		this.activeFilter = filter;
		this.ensureSelectedRow();
	}

	onSelectRow(row: TranslationMatrixRow): void {
		this.selectedKey = row.key;
		this.isDetailOpen = true;
	}

	onRowKeydown(event: KeyboardEvent, row: TranslationMatrixRow): void {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}

		event.preventDefault();
		this.onSelectRow(row);
	}

	closeDetailPanel(): void {
		this.isDetailOpen = false;
	}

	get matrix(): TranslationMatrix {
		return (
			this.scanResult?.translationMatrix ?? {
				locales: [],
				rows: [],
				totalKeys: 0
			}
		);
	}

	get locales(): string[] {
		return this.matrix.locales;
	}

	get filteredRows(): TranslationMatrixRow[] {
		const normalizedSearch = this.searchTerm.trim().toLowerCase();
		return this.matrix.rows.filter((row) => {
			if (this.activeFilter === 'missing' && !this.isRowMissing(row)) {
				return false;
			}

			if (!normalizedSearch) {
				return true;
			}

			return row.key.toLowerCase().includes(normalizedSearch);
		});
	}

	get selectedRow(): TranslationMatrixRow | undefined {
		if (!this.isDetailOpen || !this.filteredRows.length) {
			return undefined;
		}

		return this.filteredRows.find((row) => row.key === this.selectedKey) ?? this.filteredRows[0];
	}

	get allFilterCount(): number {
		return this.matrix.rows.length;
	}

	get missingFilterCount(): number {
		return this.matrix.rows.filter((row) => this.isRowMissing(row)).length;
	}

	get totalRowsLabel(): string {
		return `${this.filteredRows.length} of ${this.matrix.totalKeys} keys`;
	}

	get selectedMissingLocales(): string[] {
		if (!this.selectedRow) {
			return [];
		}

		return this.locales.filter((locale) => !this.valueFor(this.selectedRow as TranslationMatrixRow, locale));
	}

	get selectedCoverageLabel(): string {
		if (!this.selectedRow || this.locales.length === 0) {
			return '0/0';
		}

		const presentCount = this.locales.filter((locale) => Boolean(this.valueFor(this.selectedRow as TranslationMatrixRow, locale))).length;
		return `${presentCount}/${this.locales.length}`;
	}

	localeStatusLabel(row: TranslationMatrixRow): string {
		const presentCount = this.locales.filter((locale) => Boolean(this.valueFor(row, locale))).length;
		return `${presentCount}/${this.locales.length}`;
	}

	missingLocalesLabel(row: TranslationMatrixRow): string {
		const missingLocales = this.locales.filter((locale) => !this.valueFor(row, locale));
		if (!missingLocales.length) {
			return 'None';
		}

		return missingLocales.join(', ');
	}

	async copySelectedKey(): Promise<void> {
		if (!this.selectedRow) {
			return;
		}

		await navigator.clipboard.writeText(this.selectedRow.key);
		this.keyCopied = true;
		setTimeout(() => {
			this.keyCopied = false;
		}, 1500);
	}

	valueFor(row: TranslationMatrixRow, locale: string): string {
		return row.values[locale] ?? '';
	}

	isRowMissing(row: TranslationMatrixRow): boolean {
		return this.locales.some((locale) => !this.valueFor(row, locale));
	}

	private ensureSelectedRow(): void {
		if (!this.filteredRows.length) {
			this.selectedKey = undefined;
			this.isDetailOpen = false;
			return;
		}

		if (
			this.isDetailOpen &&
			(!this.selectedKey || !this.filteredRows.some((row) => row.key === this.selectedKey))
		) {
			this.selectedKey = this.filteredRows[0].key;
		}
	}
}
