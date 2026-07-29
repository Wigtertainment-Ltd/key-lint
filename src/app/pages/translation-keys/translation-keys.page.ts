import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
	ProjectScanResult,
	TranslationMatrix,
	TranslationMatrixRow
} from '@key-lint/core';
import { ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';

@Component({
	selector: 'app-translation-keys-page',
	standalone: true,
	templateUrl: './translation-keys.page.html',
	styleUrl: './translation-keys.page.scss'
})
export class TranslationKeysPage implements OnInit, OnDestroy {
	scanResult?: ProjectScanResult;
	activeFilter: 'all' | 'missing-key' | 'empty-value' = 'all';
	searchTerm = '';
	selectedKey?: string;
	isDetailOpen = false;
	keyCopied = false;
	isAddTranslationModalOpen = false;
	addTranslationLocale?: string;
	addTranslationValue = '';
	isAddingTranslation = false;
	addTranslationError = '';
	addTranslationSuccess = '';
	modalOffsetX = 0;
	modalOffsetY = 0;
	isModalDragging = false;
	private modalDragPointerId?: number;
	private modalDragStartX = 0;
	private modalDragStartY = 0;
	private readonly resolvedLocaleIds = new Set<string>();
	private readonly resolvedLocaleTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly resolvedRowKeys = new Set<string>();
	private readonly resolvedRowTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
		for (const timer of this.resolvedLocaleTimers.values()) {
			clearTimeout(timer);
		}
		this.resolvedLocaleTimers.clear();
		for (const timer of this.resolvedRowTimers.values()) {
			clearTimeout(timer);
		}
		this.resolvedRowTimers.clear();
	}

	onSearchChange(value: string): void {
		this.searchTerm = value;
		this.ensureSelectedRow();
	}

	onFilterChange(filter: 'all' | 'missing-key' | 'empty-value'): void {
		this.activeFilter = filter;
		this.ensureSelectedRow();
	}

	onSelectRow(row: TranslationMatrixRow): void {
		this.selectedKey = row.key;
		this.isDetailOpen = true;
		this.addTranslationSuccess = '';
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
		this.isAddTranslationModalOpen = false;
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
			if (
				this.activeFilter === 'missing-key' &&
				!this.isRowMissingKey(row) &&
				!this.isRowRecentlyResolved(row.key)
			) {
				return false;
			}

			if (this.activeFilter === 'empty-value' && !this.isRowEmptyValue(row)) {
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
		return this.matrix.rows.filter((row) => this.isRowMissingKey(row)).length;
	}

	get emptyValueFilterCount(): number {
		return this.matrix.rows.filter((row) => this.isRowEmptyValue(row)).length;
	}

	get totalRowsLabel(): string {
		return `${this.filteredRows.length} of ${this.matrix.totalKeys} keys`;
	}

	get selectedMissingLocales(): string[] {
		if (!this.selectedRow) {
			return [];
		}

		return this.locales.filter(
			(locale) => !this.hasLocaleKey(this.selectedRow as TranslationMatrixRow, locale)
		);
	}

	get selectedEmptyValueLocales(): string[] {
		if (!this.selectedRow) {
			return [];
		}

		return this.locales.filter((locale) => this.isLocaleEmptyValue(this.selectedRow as TranslationMatrixRow, locale));
	}

	get displayedMissingLocales(): string[] {
		if (!this.selectedRow) {
			return [];
		}

		const missing = this.selectedMissingLocales;
		const pendingResolved = this.locales.filter(
			(locale) => !missing.includes(locale) && this.isLocaleRecentlyResolvedForKey(this.selectedRow!.key, locale)
		);

		return [...missing, ...pendingResolved];
	}

	get selectedCoverageLabel(): string {
		if (!this.selectedRow || this.locales.length === 0) {
			return '0/0';
		}

		const presentCount = this.locales.filter(
			(locale) => this.hasLocaleTranslation(this.selectedRow as TranslationMatrixRow, locale)
		).length;
		return `${presentCount}/${this.locales.length}`;
	}

	localeStatusLabel(row: TranslationMatrixRow): string {
		const presentCount = this.locales.filter((locale) => this.hasLocaleTranslation(row, locale)).length;
		return `${presentCount}/${this.locales.length}`;
	}

	missingLocalesLabel(row: TranslationMatrixRow): string {
		const missingKeyLocales = this.locales.filter((locale) => !this.hasLocaleKey(row, locale));
		const emptyValueLocales = this.locales.filter((locale) => this.isLocaleEmptyValue(row, locale));

		const chunks: string[] = [];
		if (missingKeyLocales.length) {
			chunks.push(`Missing key: ${missingKeyLocales.join(', ')}`);
		}
		if (emptyValueLocales.length) {
			chunks.push(`Empty text: ${emptyValueLocales.join(', ')}`);
		}

		if (!chunks.length) {
			return 'None';
		}

		return chunks.join(' | ');
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

	openAddTranslationModal(locale: string): void {
		if (!this.selectedRow) {
			return;
		}

		if (this.isLocaleRecentlyResolved(locale)) {
			return;
		}

		this.addTranslationLocale = locale;
		this.addTranslationValue = '';
		this.addTranslationError = '';
		this.modalOffsetX = 0;
		this.modalOffsetY = 0;
		this.isModalDragging = false;
		this.modalDragPointerId = undefined;
		this.isAddTranslationModalOpen = true;
	}

	closeAddTranslationModal(force = false): void {
		if (this.isAddingTranslation && !force) {
			return;
		}

		this.isAddTranslationModalOpen = false;
		this.addTranslationLocale = undefined;
		this.addTranslationValue = '';
		this.addTranslationError = '';
		this.isModalDragging = false;
		this.modalDragPointerId = undefined;
	}

	onModalBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) {
			this.closeAddTranslationModal();
		}
	}

	onModalBackdropKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			this.closeAddTranslationModal();
		}
	}

	onModalHeaderPointerDown(event: PointerEvent, modalCard: HTMLElement): void {
		if (event.button !== 0) {
			return;
		}

		const target = event.target as HTMLElement | null;
		if (target?.closest('button')) {
			return;
		}

		const header = event.currentTarget as HTMLElement | null;
		if (!header) {
			return;
		}

		this.clampModalToViewport(modalCard);
		this.isModalDragging = true;
		this.modalDragPointerId = event.pointerId;
		this.modalDragStartX = event.clientX - this.modalOffsetX;
		this.modalDragStartY = event.clientY - this.modalOffsetY;
		header.setPointerCapture(event.pointerId);
		event.preventDefault();
	}

	onModalHeaderPointerMove(event: PointerEvent, modalCard: HTMLElement): void {
		if (!this.isModalDragging || this.modalDragPointerId !== event.pointerId) {
			return;
		}

		const nextOffsetX = event.clientX - this.modalDragStartX;
		const nextOffsetY = event.clientY - this.modalDragStartY;
		const { x, y } = this.clampOffsets(nextOffsetX, nextOffsetY, modalCard);
		this.modalOffsetX = x;
		this.modalOffsetY = y;
	}

	onModalHeaderPointerUp(event: PointerEvent): void {
		if (this.modalDragPointerId !== event.pointerId) {
			return;
		}

		const header = event.currentTarget as HTMLElement | null;
		header?.releasePointerCapture(event.pointerId);
		this.isModalDragging = false;
		this.modalDragPointerId = undefined;
	}

	get modalCardTransform(): string {
		return `translate(${this.modalOffsetX}px, ${this.modalOffsetY}px)`;
	}

	private clampModalToViewport(modalCard: HTMLElement): void {
		const { x, y } = this.clampOffsets(this.modalOffsetX, this.modalOffsetY, modalCard);
		this.modalOffsetX = x;
		this.modalOffsetY = y;
	}

	private clampOffsets(offsetX: number, offsetY: number, modalCard: HTMLElement): { x: number; y: number } {
		const viewportPadding = 16;
		const cardWidth = modalCard.offsetWidth;
		const cardHeight = modalCard.offsetHeight;
		const maxAbsX = Math.max(0, (window.innerWidth - cardWidth) / 2 - viewportPadding);
		const maxAbsY = Math.max(0, (window.innerHeight - cardHeight) / 2 - viewportPadding);

		return {
			x: Math.min(maxAbsX, Math.max(-maxAbsX, offsetX)),
			y: Math.min(maxAbsY, Math.max(-maxAbsY, offsetY))
		};
	}

	async addSelectedKeyToLocale(): Promise<void> {
		if (!this.selectedRow || !this.addTranslationLocale) {
			return;
		}

		this.isAddingTranslation = true;
		this.addTranslationError = '';
		const locale = this.addTranslationLocale;
		const key = this.selectedRow.key;
		const missingLocalesBeforeAdd = [...this.selectedMissingLocales];
		const resolvesMissingKey =
			missingLocalesBeforeAdd.length === 1 && missingLocalesBeforeAdd[0] === locale;

		try {
			await this.scanOrchestrationService.addTranslationKeyForLocale(
				locale,
				key,
				this.addTranslationValue,
				'translation-keys'
			);
			this.markLocaleResolvedForAnimation(key, locale);
			if (resolvesMissingKey) {
				this.markRowResolvedForAnimation(key);
			}
			this.ensureSelectedRow();
			this.addTranslationSuccess = `Key added for locale ${locale}.`;
			this.closeAddTranslationModal(true);
			setTimeout(() => {
				this.addTranslationSuccess = '';
			}, 2500);
		} catch (error) {
			this.addTranslationError =
				error instanceof Error ? error.message : 'Unable to add key to translation file.';
		} finally {
			this.isAddingTranslation = false;
		}
	}

	valueFor(row: TranslationMatrixRow, locale: string): string {
		return row.values[locale] ?? '';
	}

	hasLocaleTranslation(row: TranslationMatrixRow, locale: string): boolean {
		return this.valueFor(row, locale).trim().length > 0;
	}

	hasLocaleKey(row: TranslationMatrixRow, locale: string): boolean {
		if (this.isLocaleRecentlyResolvedForKey(row.key, locale)) {
			return true;
		}

		if (row.keyPresence && locale in row.keyPresence) {
			return Boolean(row.keyPresence[locale]);
		}

		return this.hasLocaleTranslation(row, locale);
	}

	isLocaleEmptyValue(row: TranslationMatrixRow, locale: string): boolean {
		return this.hasLocaleKey(row, locale) && !this.hasLocaleTranslation(row, locale);
	}

	isRowMissing(row: TranslationMatrixRow): boolean {
		return this.isRowMissingKey(row) || this.isRowEmptyValue(row);
	}

	isRowMissingKey(row: TranslationMatrixRow): boolean {
		return this.locales.some((locale) => !this.hasLocaleKey(row, locale));
	}

	isRowEmptyValue(row: TranslationMatrixRow): boolean {
		return this.locales.some((locale) => this.isLocaleEmptyValue(row, locale));
	}

	isResolvedRow(row: TranslationMatrixRow): boolean {
		return this.isRowRecentlyResolved(row.key);
	}

	isLocaleRecentlyResolved(locale: string): boolean {
		if (!this.selectedRow) {
			return false;
		}

		return this.isLocaleRecentlyResolvedForKey(this.selectedRow.key, locale);
	}

	private isLocaleRecentlyResolvedForKey(key: string, locale: string): boolean {
		return this.resolvedLocaleIds.has(this.buildLocaleResolutionId(key, locale));
	}

	private isKeyRecentlyResolved(key: string): boolean {
		for (const id of this.resolvedLocaleIds) {
			if (id.startsWith(`${key}::`)) {
				return true;
			}
		}

		return false;
	}

	private isRowRecentlyResolved(key: string): boolean {
		return this.resolvedRowKeys.has(key);
	}

	private markLocaleResolvedForAnimation(key: string, locale: string): void {
		const id = this.buildLocaleResolutionId(key, locale);
		this.resolvedLocaleIds.add(id);

		const existingTimer = this.resolvedLocaleTimers.get(id);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		const timer = setTimeout(() => {
			this.resolvedLocaleIds.delete(id);
			this.resolvedLocaleTimers.delete(id);
		}, 1600);
		this.resolvedLocaleTimers.set(id, timer);
	}

	private markRowResolvedForAnimation(key: string): void {
		this.resolvedRowKeys.add(key);

		const existingTimer = this.resolvedRowTimers.get(key);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		const timer = setTimeout(() => {
			this.resolvedRowKeys.delete(key);
			this.resolvedRowTimers.delete(key);
		}, 1600);
		this.resolvedRowTimers.set(key, timer);
	}

	private buildLocaleResolutionId(key: string, locale: string): string {
		return `${key}::${locale}`;
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
