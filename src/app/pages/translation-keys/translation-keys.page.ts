import { Component, computed, effect, inject, Injector, OnDestroy, OnInit, signal, ViewChild, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { Router } from '@angular/router';
import { IProjectScanResult, ITranslationMatrix, ITranslationMatrixRow } from '@key-lint/core';
import { ScanOrchestrationService, ScanExecutionSnapshot } from '../../shared/services/scan-orchestration.service';
import { ToastService } from '../../shared/services/toast.service';

@Component({
	selector: 'app-translation-keys-page',
	imports: [ScrollingModule],
	templateUrl: './translation-keys.page.html',
	styleUrl: './translation-keys.page.scss'
})
export class TranslationKeysPage implements OnInit, OnDestroy {
	@ViewChild(CdkVirtualScrollViewport) private tableViewport?: CdkVirtualScrollViewport;
	private readonly scanOrchestrationService: ScanOrchestrationService = inject(ScanOrchestrationService);
	private readonly router: Router = inject(Router);
	private readonly toastService: ToastService = inject(ToastService);
	private readonly injector: Injector = inject(Injector);
	private readonly scanSnapshot: Signal<ScanExecutionSnapshot> = toSignal(this.scanOrchestrationService.state$, {
		initialValue: this.scanOrchestrationService.snapshot
	});
	private readonly localScanResult: WritableSignal<IProjectScanResult | undefined> = signal<IProjectScanResult | undefined>(undefined);
	private readonly scanResultSignal: Signal<IProjectScanResult | undefined> = computed((): IProjectScanResult | undefined => this.localScanResult() ?? this.scanSnapshot().result);

	private readonly activeFilterSignal: WritableSignal<'all' | 'placeholders' | 'missing-key' | 'empty-value'> = signal<'all' | 'missing-key' | 'empty-value' | 'placeholders'>(
		'all'
	);
	private readonly searchTermSignal: WritableSignal<string> = signal('');
	selectedKey?: string;
	isDetailOpen: boolean = false;
	private readonly keyCopiedSignal: WritableSignal<boolean> = signal(false);
	isAddTranslationModalOpen: boolean = false;
	addTranslationLocale?: string;
	addTranslationValue: string = '';
	isAddingTranslation: boolean = false;
	private readonly addTranslationErrorSignal: WritableSignal<string> = signal('');
	modalOffsetX: number = 0;
	modalOffsetY: number = 0;
	isModalDragging: boolean = false;
	private modalDragPointerId?: number;
	private modalDragStartX: number = 0;
	private modalDragStartY: number = 0;
	private readonly resolvedLocaleIds: Set<string> = new Set<string>();
	private readonly resolvedLocaleTimers: Map<string, number> = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly resolvedRowKeys: Set<string> = new Set<string>();
	private readonly resolvedRowTimers: Map<string, number> = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly animationStateVersion: WritableSignal<number> = signal(0);
	private readonly filteredRowsSignal: Signal<ITranslationMatrixRow[]> = computed((): ITranslationMatrixRow[] => {
		const normalizedSearch: string = this.searchTermSignal().trim().toLowerCase();
		const activeFilter: 'all' | 'placeholders' | 'missing-key' | 'empty-value' = this.activeFilterSignal();
		return this.matrix.rows.filter((row: ITranslationMatrixRow): boolean => {
			if (activeFilter === 'missing-key' && !this.isRowMissingKey(row) && !this.isRowRecentlyResolved(row.key)) {
				return false;
			}

			if (activeFilter === 'empty-value' && !this.isRowEmptyValue(row)) {
				return false;
			}
			if (activeFilter === 'placeholders' && !this.hasPlaceholders(row)) {
				return false;
			}

			return !normalizedSearch || row.key.toLowerCase().includes(normalizedSearch);
		});
	});
	private readonly filterCountsSignal: Signal<{ missing: number; empty: number; placeholders: number }> = computed(
		(): { missing: number; empty: number; placeholders: number } => {
			this.animationStateVersion();
			let missing: number = 0;
			let empty: number = 0;
			let placeholders: number = 0;
			for (const row of this.matrix.rows) {
				if (this.isRowMissingKey(row)) {
					missing++;
				}
				if (this.isRowEmptyValue(row)) {
					empty++;
				}
				if (this.hasPlaceholders(row)) {
					placeholders++;
				}
			}
			return { missing, empty, placeholders };
		}
	);

	get activeFilter(): ReturnType<typeof this.activeFilterSignal> {
		return this.activeFilterSignal();
	}

	get addTranslationError(): string {
		return this.addTranslationErrorSignal();
	}

	set addTranslationError(value: string) {
		this.addTranslationErrorSignal.set(value);
	}

	get keyCopied(): boolean {
		return this.keyCopiedSignal();
	}

	set keyCopied(value: boolean) {
		this.keyCopiedSignal.set(value);
	}

	private get scanResult(): IProjectScanResult | undefined {
		return this.scanResultSignal();
	}

	private set scanResult(value: IProjectScanResult | undefined) {
		this.localScanResult.set(value);
	}

	ngOnInit(): void {
		this.scanResult = this.scanOrchestrationService.snapshot.result;
		this.ensureSelectedRow();

		effect(
			(): void => {
				const snapshotResult: IProjectScanResult | undefined = this.scanSnapshot().result;
				if (!snapshotResult) {
					return;
				}

				this.localScanResult.set(snapshotResult);
				this.ensureSelectedRow();
			},
			{ injector: this.injector }
		);

		if (!this.scanResult) {
			void this.router.navigate(['/scan-progress']);
		}
	}

	ngOnDestroy(): void {
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
		this.searchTermSignal.set(value);
		this.tableViewport?.scrollToIndex(0);
		this.ensureSelectedRow();
	}

	onFilterChange(filter: 'all' | 'missing-key' | 'empty-value' | 'placeholders'): void {
		this.activeFilterSignal.set(filter);
		this.tableViewport?.scrollToIndex(0);
		this.ensureSelectedRow();
	}

	onSelectRow(row: ITranslationMatrixRow): void {
		this.selectedKey = row.key;
		this.isDetailOpen = true;
	}

	trackRow(_index: number, row: ITranslationMatrixRow): string {
		return row.key;
	}

	onRowKeydown(event: KeyboardEvent, row: ITranslationMatrixRow): void {
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

	get matrix(): ITranslationMatrix {
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

	get filteredRows(): ITranslationMatrixRow[] {
		return this.filteredRowsSignal();
	}

	get selectedRow(): ITranslationMatrixRow | undefined {
		if (!this.isDetailOpen || !this.filteredRows.length) {
			return undefined;
		}

		return this.filteredRows.find((row: ITranslationMatrixRow): boolean => row.key === this.selectedKey) ?? this.filteredRows[0];
	}

	get allFilterCount(): number {
		return this.matrix.rows.length;
	}

	get missingFilterCount(): number {
		return this.filterCountsSignal().missing;
	}

	get emptyValueFilterCount(): number {
		return this.filterCountsSignal().empty;
	}

	get placeholderFilterCount(): number {
		return this.filterCountsSignal().placeholders;
	}

	placeholderNames(row: ITranslationMatrixRow): string[] {
		return [...new Set(this.locales.flatMap((locale: string): string[] => row.placeholders?.[locale] ?? []))].sort((a: string, b: string): number => a.localeCompare(b));
	}

	placeholderNamesForLocale(row: ITranslationMatrixRow, locale: string): string[] {
		return row.placeholders?.[locale] ?? [];
	}

	hasPlaceholders(row: ITranslationMatrixRow): boolean {
		return this.placeholderNames(row).length > 0;
	}

	get totalRowsLabel(): string {
		return `${this.filteredRows.length} of ${this.matrix.totalKeys} keys`;
	}

	get selectedMissingLocales(): string[] {
		const selectedRow: ITranslationMatrixRow | undefined = this.selectedRow;
		if (!selectedRow) {
			return [];
		}

		return this.locales.filter((locale: string): boolean => !this.hasLocaleKey(selectedRow, locale));
	}

	get isRemoteReadOnly(): boolean {
		return this.scanResult?.metadata?.['translationReadOnly'] === true;
	}

	get selectedEmptyValueLocales(): string[] {
		const selectedRow: ITranslationMatrixRow | undefined = this.selectedRow;
		if (!selectedRow) {
			return [];
		}

		return this.locales.filter((locale: string): boolean => this.isLocaleEmptyValue(selectedRow, locale));
	}

	get displayedMissingLocales(): string[] {
		const selectedRow: ITranslationMatrixRow | undefined = this.selectedRow;
		if (!selectedRow) {
			return [];
		}

		const missing: string[] = this.selectedMissingLocales;
		const pendingResolved: string[] = this.locales.filter((locale: string): boolean => !missing.includes(locale) && this.isLocaleRecentlyResolvedForKey(selectedRow.key, locale));

		return [...missing, ...pendingResolved];
	}

	get selectedCoverageLabel(): string {
		const selectedRow: ITranslationMatrixRow | undefined = this.selectedRow;
		if (!selectedRow || this.locales.length === 0) {
			return '0/0';
		}

		const presentCount: number = this.locales.filter((locale: string): boolean => this.hasLocaleTranslation(selectedRow, locale)).length;
		return `${presentCount}/${this.locales.length}`;
	}

	localeStatusLabel(row: ITranslationMatrixRow): string {
		const presentCount: number = this.locales.filter((locale: string): boolean => this.hasLocaleTranslation(row, locale)).length;
		return `${presentCount}/${this.locales.length}`;
	}

	missingLocalesLabel(row: ITranslationMatrixRow): string {
		const missingKeyLocales: string[] = this.locales.filter((locale: string): boolean => !this.hasLocaleKey(row, locale));
		const emptyValueLocales: string[] = this.locales.filter((locale: string): boolean => this.isLocaleEmptyValue(row, locale));

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
		setTimeout((): void => {
			this.keyCopied = false;
		}, 1500);
	}

	openAddTranslationModal(locale: string): void {
		if (!this.selectedRow || this.isRemoteReadOnly) {
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

	closeAddTranslationModal(force: boolean = false): void {
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

		const target: HTMLElement | null = event.target as HTMLElement | null;
		if (target?.closest('button')) {
			return;
		}

		const header: HTMLElement | null = event.currentTarget as HTMLElement | null;
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

		const nextOffsetX: number = event.clientX - this.modalDragStartX;
		const nextOffsetY: number = event.clientY - this.modalDragStartY;
		const { x, y }: { x: number; y: number; } = this.clampOffsets(nextOffsetX, nextOffsetY, modalCard);
		this.modalOffsetX = x;
		this.modalOffsetY = y;
	}

	onModalHeaderPointerUp(event: PointerEvent): void {
		if (this.modalDragPointerId !== event.pointerId) {
			return;
		}

		const header: HTMLElement | null = event.currentTarget as HTMLElement | null;
		header?.releasePointerCapture(event.pointerId);
		this.isModalDragging = false;
		this.modalDragPointerId = undefined;
	}

	get modalCardTransform(): string {
		return `translate(${this.modalOffsetX}px, ${this.modalOffsetY}px)`;
	}

	private clampModalToViewport(modalCard: HTMLElement): void {
		const { x, y }: { x: number; y: number; } = this.clampOffsets(this.modalOffsetX, this.modalOffsetY, modalCard);
		this.modalOffsetX = x;
		this.modalOffsetY = y;
	}

	private clampOffsets(offsetX: number, offsetY: number, modalCard: HTMLElement): { x: number; y: number } {
		const viewportPadding: number = 16;
		const cardWidth: number = modalCard.offsetWidth;
		const cardHeight: number = modalCard.offsetHeight;
		const maxAbsX: number = Math.max(0, (window.innerWidth - cardWidth) / 2 - viewportPadding);
		const maxAbsY: number = Math.max(0, (window.innerHeight - cardHeight) / 2 - viewportPadding);

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
		const locale: string = this.addTranslationLocale;
		const key: string = this.selectedRow.key;
		const missingLocalesBeforeAdd: string[] = [...this.selectedMissingLocales];
		const resolvesMissingKey: boolean = missingLocalesBeforeAdd.length === 1 && missingLocalesBeforeAdd[0] === locale;

		try {
			await this.scanOrchestrationService.addTranslationKeyForLocale(locale, key, this.addTranslationValue, 'translation-keys');
			this.markLocaleResolvedForAnimation(key, locale);
			if (resolvesMissingKey) {
				this.markRowResolvedForAnimation(key);
			}
			this.ensureSelectedRow();
			this.toastService.success(`Key added for locale ${locale}.`);
			this.closeAddTranslationModal(true);
		} catch (error: unknown) {
			this.addTranslationError = error instanceof Error ? error.message : 'Unable to add key to translation file.';
		} finally {
			this.isAddingTranslation = false;
		}
	}

	valueFor(row: ITranslationMatrixRow, locale: string): string {
		return row.values[locale] ?? '';
	}

	hasLocaleTranslation(row: ITranslationMatrixRow, locale: string): boolean {
		return this.valueFor(row, locale).trim().length > 0;
	}

	hasLocaleKey(row: ITranslationMatrixRow, locale: string): boolean {
		if (this.isLocaleRecentlyResolvedForKey(row.key, locale)) {
			return true;
		}

		if (row.keyPresence && locale in row.keyPresence) {
			return Boolean(row.keyPresence[locale]);
		}

		return this.hasLocaleTranslation(row, locale);
	}

	isLocaleEmptyValue(row: ITranslationMatrixRow, locale: string): boolean {
		return this.hasLocaleKey(row, locale) && !this.hasLocaleTranslation(row, locale);
	}

	isRowMissing(row: ITranslationMatrixRow): boolean {
		return this.isRowMissingKey(row) || this.isRowEmptyValue(row);
	}

	isRowMissingKey(row: ITranslationMatrixRow): boolean {
		return this.locales.some((locale: string): boolean => !this.hasLocaleKey(row, locale));
	}

	isRowEmptyValue(row: ITranslationMatrixRow): boolean {
		return this.locales.some((locale: string): boolean => this.isLocaleEmptyValue(row, locale));
	}

	isResolvedRow(row: ITranslationMatrixRow): boolean {
		return this.isRowRecentlyResolved(row.key);
	}

	isLocaleRecentlyResolved(locale: string): boolean {
		if (!this.selectedRow) {
			return false;
		}

		return this.isLocaleRecentlyResolvedForKey(this.selectedRow.key, locale);
	}

	private isLocaleRecentlyResolvedForKey(key: string, locale: string): boolean {
		// Track animation-state mutations so OnPush views refresh when timers mutate sets.
		this.animationStateVersion();
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
		this.animationStateVersion();
		return this.resolvedRowKeys.has(key);
	}

	private markLocaleResolvedForAnimation(key: string, locale: string): void {
		const id: string = this.buildLocaleResolutionId(key, locale);
		this.resolvedLocaleIds.add(id);
		this.bumpAnimationStateVersion();

		const existingTimer: number | undefined = this.resolvedLocaleTimers.get(id);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		const timer: number = setTimeout((): void => {
			this.resolvedLocaleIds.delete(id);
			this.resolvedLocaleTimers.delete(id);
			this.bumpAnimationStateVersion();
		}, 1600);
		this.resolvedLocaleTimers.set(id, timer);
	}

	private markRowResolvedForAnimation(key: string): void {
		this.resolvedRowKeys.add(key);
		this.bumpAnimationStateVersion();

		const existingTimer: number | undefined = this.resolvedRowTimers.get(key);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		const timer: number = setTimeout((): void => {
			this.resolvedRowKeys.delete(key);
			this.resolvedRowTimers.delete(key);
			this.bumpAnimationStateVersion();
		}, 1600);
		this.resolvedRowTimers.set(key, timer);
	}

	private bumpAnimationStateVersion(): void {
		this.animationStateVersion.update((value: number): number => value + 1);
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

		if (this.isDetailOpen && (!this.selectedKey || !this.filteredRows.some((row: ITranslationMatrixRow): boolean => row.key === this.selectedKey))) {
			this.selectedKey = this.filteredRows[0].key;
		}
	}
}
