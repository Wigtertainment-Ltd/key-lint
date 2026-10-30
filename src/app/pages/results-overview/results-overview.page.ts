import { Component, computed, effect, inject, Injector, OnDestroy, OnInit, signal, ViewChild, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { Router } from '@angular/router';
import { hasTranslationKey, IFinding, IProjectScanResult, IFileEvidence, ITranslationMatrixRow, IScanSummary } from '@key-lint/core';
import { ScanOrchestrationService, ScanExecutionSnapshot } from '../../shared/services/scan-orchestration.service';
import { ToastService } from '../../shared/services/toast.service';
import { LoggerService } from '../../shared/services/logging/logger.service';

@Component({
	selector: 'app-results-overview-page',
	imports: [ScrollingModule],
	templateUrl: './results-overview.page.html',
	styleUrl: './results-overview.page.scss'
})
export class ResultsOverviewPage implements OnInit, OnDestroy {
	@ViewChild(CdkVirtualScrollViewport) private tableViewport?: CdkVirtualScrollViewport;
	private readonly scanOrchestrationService: ScanOrchestrationService = inject(ScanOrchestrationService);
	private readonly router: Router = inject(Router);
	private readonly toastService: ToastService = inject(ToastService);
	private readonly injector: Injector = inject(Injector);
	private readonly loggerService: LoggerService = inject(LoggerService);
	private readonly scanSnapshot: Signal<ScanExecutionSnapshot> = toSignal(this.scanOrchestrationService.state$, {
		initialValue: this.scanOrchestrationService.snapshot
	});
	private readonly localScanResult: WritableSignal<IProjectScanResult | undefined> = signal<IProjectScanResult | undefined>(undefined);
	private readonly scanResultSignal: Signal<IProjectScanResult | undefined> = computed((): IProjectScanResult | undefined => this.localScanResult() ?? this.scanSnapshot().result);
	private readonly activeFilterSignal: WritableSignal<
		'used' | 'unused' | 'dynamic-uncertain' | 'indirect-uncertain' | 'missing-in-language' | 'extra-in-language' | 'all' | 'placeholders'
	> = signal<'all' | 'missing-in-language' | 'unused' | 'dynamic-uncertain' | 'indirect-uncertain' | 'extra-in-language' | 'placeholders' | 'used'>('all');
	private readonly searchTermSignal: WritableSignal<string> = signal('');
	selectedFindingId?: string;
	isDetailOpen: boolean = false;
	private readonly keyCopiedSignal: WritableSignal<boolean> = signal(false);
	private readonly copiedPathSignal: WritableSignal<string | undefined> = signal<string | undefined>(undefined);
	isAddTranslationModalOpen: boolean = false;
	isSavingTranslations: boolean = false;
	private readonly addTranslationsErrorSignal: WritableSignal<string> = signal('');
	translationDrafts: Partial<Record<string, string>> = {};
	private readonly resolvedFindingIds: Set<string> = new Set<string>();
	private readonly hiddenResolvedMissingFindingIds: Set<string> = new Set<string>();
	private readonly resolvedRemovalTimers: Map<string, number> = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly animationStateVersion: WritableSignal<number> = signal(0);
	private readonly filteredFindingsSignal: Signal<IFinding[]> = computed((): IFinding[] => {
		this.animationStateVersion();
		const normalizedSearch: string = this.searchTermSignal().trim().toLowerCase();
		const activeFilter: 'used' | 'unused' | 'dynamic-uncertain' | 'indirect-uncertain' | 'missing-in-language' | 'extra-in-language' | 'all' | 'placeholders' =
			this.activeFilterSignal();
		return this.findings.filter((finding: IFinding): boolean => {
			if (this.hiddenResolvedMissingFindingIds.has(finding.id)) {
				return false;
			}

			if (activeFilter === 'missing-in-language' && this.resolvedFindingIds.has(finding.id)) {
				return false;
			}

			const isPlaceholderFinding: boolean = finding.status.startsWith('placeholder-');
			if (activeFilter === 'placeholders' && !isPlaceholderFinding) {
				return false;
			}

			if (activeFilter !== 'all' && activeFilter !== 'placeholders' && finding.status !== activeFilter) {
				return false;
			}

			if (!normalizedSearch) {
				return true;
			}

			const evidencePath: string = finding.evidence[0]?.filePath?.toLowerCase() ?? '';
			return finding.key.toLowerCase().includes(normalizedSearch) || finding.message.toLowerCase().includes(normalizedSearch) || evidencePath.includes(normalizedSearch);
		});
	});
	private readonly filterCountsSignal: Signal<{ missing: number; unused: number; dynamic: number; indirect: number; extra: number; placeholders: number; used: number }> =
		computed((): { missing: number; unused: number; dynamic: number; indirect: number; extra: number; placeholders: number; used: number } => {
			const counts: { missing: number; unused: number; dynamic: number; indirect: number; extra: number; placeholders: number; used: number } = {
				missing: 0,
				unused: 0,
				dynamic: 0,
				indirect: 0,
				extra: 0,
				placeholders: 0,
				used: 0
			};

			for (const finding of this.findings) {
				if (finding.status.startsWith('placeholder-')) {
					counts.placeholders++;
				}
				switch (finding.status) {
					case 'missing-in-language':
						counts.missing++;
						break;
					case 'unused':
						counts.unused++;
						break;
					case 'dynamic-uncertain':
						counts.dynamic++;
						break;
					case 'indirect-uncertain':
						counts.indirect++;
						break;
					case 'extra-in-language':
						counts.extra++;
						break;
					case 'used':
						counts.used++;
						break;
				}
			}

			return counts;
		});

	get activeFilter(): ReturnType<typeof this.activeFilterSignal> {
		return this.activeFilterSignal();
	}

	get addTranslationsError(): string {
		return this.addTranslationsErrorSignal();
	}

	set addTranslationsError(value: string) {
		this.addTranslationsErrorSignal.set(value);
	}

	get keyCopied(): boolean {
		return this.keyCopiedSignal();
	}

	set keyCopied(value: boolean) {
		this.keyCopiedSignal.set(value);
	}

	get copiedPath(): string | undefined {
		return this.copiedPathSignal();
	}

	set copiedPath(value: string | undefined) {
		this.copiedPathSignal.set(value);
	}

	private get scanResult(): IProjectScanResult | undefined {
		return this.scanResultSignal();
	}

	private set scanResult(value: IProjectScanResult | undefined) {
		this.localScanResult.set(value);
	}

	ngOnInit(): void {
		this.scanResult = this.scanOrchestrationService.snapshot.result;
		this.loggerService.info('ResultsOverviewPage', 'initialized with scan result:', this.scanResult);
		this.ensureSelectedFinding();

		effect(
			(): void => {
				const snapshotResult: IProjectScanResult | undefined = this.scanSnapshot().result;
				if (!snapshotResult) {
					return;
				}

				this.localScanResult.set(snapshotResult);
				this.ensureSelectedFinding();
			},
			{ injector: this.injector }
		);

		if (!this.scanResult) {
			void this.router.navigate(['/scan-progress']);
		}
	}

	ngOnDestroy(): void {
		for (const timer of this.resolvedRemovalTimers.values()) {
			clearTimeout(timer);
		}
		this.resolvedRemovalTimers.clear();
	}

	onFilterChange(filter: 'all' | 'missing-in-language' | 'unused' | 'dynamic-uncertain' | 'indirect-uncertain' | 'extra-in-language' | 'placeholders' | 'used'): void {
		this.activeFilterSignal.set(filter);
		this.tableViewport?.scrollToIndex(0);
		this.ensureSelectedFinding();
	}

	onSearchChange(value: string): void {
		this.searchTermSignal.set(value);
		this.tableViewport?.scrollToIndex(0);
		this.ensureSelectedFinding();
	}

	onSelectFinding(finding: IFinding): void {
		this.selectedFindingId = finding.id;
		this.isDetailOpen = true;
	}

	trackFinding(_index: number, finding: IFinding): string {
		return finding.id;
	}

	closeDetailPanel(): void {
		this.isDetailOpen = false;
		this.closeAddTranslationModal(true);
	}

	async copySelectedKey(): Promise<void> {
		if (!this.selectedFinding) {
			return;
		}

		await navigator.clipboard.writeText(this.selectedFinding.key);
		this.keyCopied = true;
		setTimeout((): void => {
			this.keyCopied = false;
		}, 1500);
	}

	getFileName(filePath: string): string {
		const parts: string[] = filePath.replaceAll('\\', '/').split('/');
		return parts.at(-1) ?? filePath;
	}

	async onCopyPath(event: Event, fullPath: string): Promise<void> {
		event.stopPropagation();
		await navigator.clipboard.writeText(fullPath);
		this.copiedPath = fullPath;
		setTimeout((): void => {
			this.copiedPath = undefined;
		}, 1500);
	}

	openAddTranslationModal(): void {
		if (!this.selectedFinding || !this.canShowAddToTranslationsAction) {
			return;
		}

		this.translationDrafts = {};
		for (const locale of this.selectedMissingLocales) {
			this.translationDrafts[locale] = '';
		}

		this.addTranslationsError = '';
		this.isAddTranslationModalOpen = true;
	}

	closeAddTranslationModal(force: boolean = false): void {
		if (this.isSavingTranslations && !force) {
			return;
		}

		this.isAddTranslationModalOpen = false;
		this.addTranslationsError = '';
		this.translationDrafts = {};
	}

	onAddTranslationModalBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) {
			this.closeAddTranslationModal();
		}
	}

	onAddTranslationModalBackdropKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			this.closeAddTranslationModal();
		}
	}

	onTranslationDraftChange(locale: string, value: string): void {
		this.translationDrafts[locale] = value;
	}

	async addSelectedKeyToTranslationFiles(): Promise<void> {
		if (!this.selectedFinding || !this.selectedMissingLocales.length) {
			return;
		}

		this.isSavingTranslations = true;
		this.addTranslationsError = '';

		try {
			const key: string = this.selectedFinding.key;
			const resolvedLocales: string[] = [...this.selectedMissingLocales];
			const resolvedLocaleCount: number = resolvedLocales.length;
			for (const locale of resolvedLocales) {
				await this.scanOrchestrationService.addTranslationKeyForLocale(locale, key, this.translationDrafts[locale] ?? '', 'results-overview');
			}

			this.reconcileResolvedMissingFindings(key, resolvedLocales);
			this.ensureSelectedFinding();

			this.toastService.success(`Added key to ${resolvedLocaleCount} locale file(s).`);
			this.closeAddTranslationModal(true);
		} catch (error: unknown) {
			this.addTranslationsError = error instanceof Error ? error.message : 'Unable to add key to translation files.';
		} finally {
			this.isSavingTranslations = false;
		}
	}

	get findings(): IFinding[] {
		return this.scanResult?.findings ?? [];
	}

	get filteredFindings(): IFinding[] {
		return this.filteredFindingsSignal();
	}

	get selectedFinding(): IFinding | undefined {
		if (!this.isDetailOpen) {
			return undefined;
		}

		if (!this.filteredFindings.length) {
			return undefined;
		}

		return this.filteredFindings.find((finding: IFinding): boolean => finding.id === this.selectedFindingId) ?? this.filteredFindings[0];
	}

	get allFilterCount(): number {
		return this.findings.length;
	}

	get missingFilterCount(): number {
		return this.filterCountsSignal().missing;
	}

	get unusedFilterCount(): number {
		return this.filterCountsSignal().unused;
	}

	get dynamicFilterCount(): number {
		return this.filterCountsSignal().dynamic;
	}

	get indirectFilterCount(): number {
		return this.filterCountsSignal().indirect;
	}

	get usedFilterCount(): number {
		return this.filterCountsSignal().used;
	}

	get selectedEvidencePath(): string {
		if (!this.selectedFinding) {
			return 'No source evidence available';
		}

		const firstEvidence: IFileEvidence = this.selectedFinding.evidence[0];
		if (!firstEvidence) {
			return 'No source evidence available';
		}

		const lineSuffix: string = firstEvidence.line ? `:${firstEvidence.line}` : '';
		return `${firstEvidence.filePath}${lineSuffix}`;
	}

	get selectedSnippet(): string {
		return this.selectedFinding?.evidence[0]?.snippet ?? `{{ '${this.selectedFinding?.key ?? ''}' | translate }}`;
	}

	get matrixLocales(): string[] {
		return this.scanResult?.translationMatrix?.locales ?? [];
	}

	get selectedMissingLocales(): string[] {
		if (!this.selectedFinding) {
			return [];
		}

		const locales: string[] = this.selectedFinding.language ? [this.selectedFinding.language] : this.matrixLocales;
		if (!locales.length) {
			return [];
		}

		const row: ITranslationMatrixRow | undefined = this.scanResult?.translationMatrix?.rows.find((entry: ITranslationMatrixRow): boolean => entry.key === this.selectedFinding?.key);
		if (!row) {
			return locales;
		}

		return locales.filter((locale: string): boolean => !hasTranslationKey(row, locale));
	}

	get canShowAddToTranslationsAction(): boolean {
		return !this.isRemoteReadOnly && this.selectedFinding?.status === 'missing-in-language' && !this.isSelectedFindingResolved && this.selectedMissingLocales.length > 0;
	}

	get isRemoteReadOnly(): boolean {
		return this.scanResult?.metadata?.['translationReadOnly'] === true;
	}

	get isSelectedFindingResolved(): boolean {
		if (!this.selectedFinding) {
			return false;
		}

		// Track animation-state mutations so OnPush views refresh when timers mutate sets.
		this.animationStateVersion();
		return this.resolvedFindingIds.has(this.selectedFinding.id);
	}

	isResolvedFinding(finding: IFinding): boolean {
		this.animationStateVersion();
		return this.resolvedFindingIds.has(finding.id);
	}

	private reconcileResolvedMissingFindings(key: string, resolvedLocales: string[]): void {
		if (!this.scanResult) {
			return;
		}

		const resolvedMissingFindings: IFinding[] = this.scanResult.findings.filter(
			(finding: IFinding): boolean => finding.status === 'missing-in-language' && finding.key === key && finding.language !== undefined && resolvedLocales.includes(finding.language)
		);
		if (!resolvedMissingFindings.length) {
			return;
		}

		for (const finding of resolvedMissingFindings) {
			this.resolvedFindingIds.add(finding.id);
			this.hiddenResolvedMissingFindingIds.add(finding.id);
		}
		this.bumpAnimationStateVersion();

		const resolutionId: string = `${key}::${resolvedLocales.slice().sort().join(',')}`;
		const findingIds: string[] = resolvedMissingFindings.map((finding: IFinding): string => finding.id);
		const existingTimer: number | undefined = this.resolvedRemovalTimers.get(resolutionId);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		// In the Missing-only view users expect an immediate disappearance after adding translations.
		if (this.activeFilter === 'missing-in-language') {
			this.finalizeResolvedMissingFindings(findingIds, resolutionId);
			return;
		}

		const timer: number = setTimeout((): void => {
			this.finalizeResolvedMissingFindings(findingIds, resolutionId);
		}, 1600);
		this.resolvedRemovalTimers.set(resolutionId, timer);
	}

	get placeholderFilterCount(): number {
		return this.filterCountsSignal().placeholders;
	}

	get extraFilterCount(): number {
		return this.filterCountsSignal().extra;
	}

	private finalizeResolvedMissingFindings(findingIds: string[], resolutionId: string): void {
		if (!this.scanResult) {
			return;
		}

		const resolvedMissingFindings: IFinding[] = this.scanResult.findings.filter((finding: IFinding): boolean => findingIds.includes(finding.id));
		if (!resolvedMissingFindings.length) {
			this.resolvedRemovalTimers.delete(resolutionId);
			return;
		}

		const remainingFindings: IFinding[] = this.scanResult.findings.filter((finding: IFinding): boolean => !findingIds.includes(finding.id));

		const summary: IScanSummary = this.scanResult.summary;
		this.scanResult = {
			...this.scanResult,
			findings: remainingFindings,
			summary: {
				...summary,
				missingInLanguage: Math.max(0, summary.missingInLanguage - resolvedMissingFindings.length),
				totalFindings: Math.max(0, summary.totalFindings - resolvedMissingFindings.length)
			}
		};

		for (const finding of resolvedMissingFindings) {
			this.resolvedFindingIds.delete(finding.id);
		}
		this.bumpAnimationStateVersion();

		this.resolvedRemovalTimers.delete(resolutionId);
		this.ensureSelectedFinding();
	}

	private bumpAnimationStateVersion(): void {
		this.animationStateVersion.update((value: number): number => value + 1);
	}

	statusLabel(status: IFinding['status']): string {
		if (status === 'missing-in-language') {
			return 'Missing';
		}

		if (status === 'dynamic-uncertain') {
			return 'Dynamic';
		}

		if (status === 'indirect-uncertain') {
			return 'Indirect';
		}

		if (status === 'extra-in-language') {
			return 'Extra';
		}

		if (status === 'placeholder-missing') {
			return 'Missing Params';
		}

		if (status === 'placeholder-uncertain') {
			return 'Params Uncertain';
		}

		if (status === 'placeholder-mismatch') {
			return 'Locale Params';
		}

		return status.charAt(0).toUpperCase() + status.slice(1);
	}

	isUncertainStatus(status: string): boolean {
		return status === 'dynamic-uncertain' || status === 'indirect-uncertain' || status === 'placeholder-uncertain';
	}

	isPlaceholderError(status: IFinding['status']): boolean {
		return status === 'placeholder-missing' || status === 'placeholder-mismatch';
	}

	severityLabel(severity: IFinding['severity']): string {
		if (severity === 'error') {
			return 'High';
		}

		if (severity === 'warning') {
			return 'Medium';
		}

		return 'Low';
	}

	severityPercent(severity: IFinding['severity']): number {
		if (severity === 'error') {
			return 100;
		}

		if (severity === 'warning') {
			return 66;
		}

		return 33;
	}

	private ensureSelectedFinding(): void {
		if (!this.filteredFindings.length) {
			this.selectedFindingId = undefined;
			this.isDetailOpen = false;
			return;
		}

		if (this.isDetailOpen && (!this.selectedFindingId || !this.filteredFindings.some((finding: IFinding): boolean => finding.id === this.selectedFindingId))) {
			this.selectedFindingId = this.filteredFindings[0].id;
		}
	}

	get totalKeys(): number {
		return this.scanResult?.summary.totalKeys ?? 0;
	}

	get usedKeys(): number {
		return this.scanResult?.summary.used ?? 0;
	}

	get unusedKeys(): number {
		return this.scanResult?.summary.unused ?? 0;
	}

	get missingKeys(): number {
		return this.scanResult?.summary.missingInLanguage ?? 0;
	}

	get dynamicKeys(): number {
		return this.scanResult?.summary.dynamicOrUncertain ?? 0;
	}

	get frameworkLabel(): string {
		const adapterId: string = this.scanResult?.adapterId ?? 'unknown';
		if (adapterId === 'angular') {
			return 'Angular';
		}

		return adapterId.charAt(0).toUpperCase() + adapterId.slice(1);
	}

	get filesScanned(): number {
		const value: unknown = this.scanResult?.metadata?.['usedKeyEvidenceCount'];
		return typeof value === 'number' ? value : 0;
	}

	get scanDurationLabel(): string {
		const durationMs: number = this.scanResult?.durationMs ?? 0;
		if (durationMs >= 1000) {
			return `${(durationMs / 1000).toFixed(1)}s`;
		}

		return `${durationMs}ms`;
	}

	get localeCount(): number {
		const value: unknown = this.scanResult?.metadata?.['translationLocaleCount'];
		return typeof value === 'number' ? value : 0;
	}

	get topMissingFindings(): IFinding[] {
		if (!this.scanResult) {
			return [];
		}

		return this.scanResult.findings.filter((finding: IFinding): boolean => finding.status === 'missing-in-language').slice(0, 5);
	}

	get unusedPercent(): number {
		if (this.totalKeys === 0) {
			return 0;
		}

		return Math.round((this.unusedKeys / this.totalKeys) * 100);
	}

	get usedPercent(): number {
		if (this.totalKeys === 0) {
			return 0;
		}

		return Math.round((this.usedKeys / this.totalKeys) * 100);
	}

	get missingPercent(): number {
		if (this.totalKeys === 0) {
			return 0;
		}

		return Math.max(1, Math.round((this.missingKeys / this.totalKeys) * 100));
	}

	get dynamicPercent(): number {
		if (this.totalKeys === 0) {
			return 0;
		}

		return Math.max(1, Math.round((this.dynamicKeys / this.totalKeys) * 100));
	}
}
