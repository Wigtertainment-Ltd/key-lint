import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { Finding } from '../../core/models/finding.model';
import { ProjectScanResult } from '../../core/models/scan-result.model';
import { ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';

@Component({
	selector: 'app-results-overview-page',
	standalone: true,
	templateUrl: './results-overview.page.html',
	styleUrl: './results-overview.page.scss'
})
export class ResultsOverviewPage implements OnInit, OnDestroy {
	scanResult?: ProjectScanResult;
	activeFilter: 'all' | 'missing-in-language' | 'unused' | 'dynamic-uncertain' | 'used' = 'all';
	searchTerm = '';
	selectedFindingId?: string;
	isDetailOpen = false;
	keyCopied = false;
	isAddTranslationModalOpen = false;
	isSavingTranslations = false;
	addTranslationsError = '';
	addTranslationsSuccess = '';
	translationDrafts: Record<string, string> = {};
	private readonly resolvedFindingIds = new Set<string>();
	private readonly resolvedRemovalTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private stateSubscription?: Subscription;

	constructor(
		private readonly scanOrchestrationService: ScanOrchestrationService,
		private readonly router: Router
	) {}

	ngOnInit(): void {
		this.scanResult = this.scanOrchestrationService.snapshot.result;
		this.ensureSelectedFinding();
		this.stateSubscription = this.scanOrchestrationService.state$.subscribe((snapshot) => {
			if (snapshot.result) {
				this.scanResult = snapshot.result;
				this.ensureSelectedFinding();
			}
		});

		if (!this.scanResult) {
			void this.router.navigate(['/scan-progress']);
		}
	}

	ngOnDestroy(): void {
		this.stateSubscription?.unsubscribe();
		for (const timer of this.resolvedRemovalTimers.values()) {
			clearTimeout(timer);
		}
		this.resolvedRemovalTimers.clear();
	}

	onFilterChange(filter: 'all' | 'missing-in-language' | 'unused' | 'dynamic-uncertain' | 'used'): void {
		this.activeFilter = filter;
		this.ensureSelectedFinding();
	}

	onSearchChange(value: string): void {
		this.searchTerm = value;
		this.ensureSelectedFinding();
	}

	onSelectFinding(finding: Finding): void {
		this.selectedFindingId = finding.id;
		this.isDetailOpen = true;
		this.addTranslationsSuccess = '';
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
		setTimeout(() => {
			this.keyCopied = false;
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

	closeAddTranslationModal(force = false): void {
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
			const key = this.selectedFinding.key;
			const resolvedLocaleCount = this.selectedMissingLocales.length;
			for (const locale of this.selectedMissingLocales) {
				await this.scanOrchestrationService.addTranslationKeyForLocale(
					locale,
					key,
					this.translationDrafts[locale] ?? ''
				);
			}

			this.reconcileResolvedMissingFindings(key);
			this.ensureSelectedFinding();

			this.addTranslationsSuccess = `Added key to ${resolvedLocaleCount} locale file(s).`;
			this.closeAddTranslationModal(true);
			setTimeout(() => {
				this.addTranslationsSuccess = '';
			}, 2500);
		} catch (error) {
			this.addTranslationsError =
				error instanceof Error ? error.message : 'Unable to add key to translation files.';
		} finally {
			this.isSavingTranslations = false;
		}
	}

	get findings(): Finding[] {
		return this.scanResult?.findings ?? [];
	}

	get filteredFindings(): Finding[] {
		const normalizedSearch = this.searchTerm.trim().toLowerCase();
		return this.findings.filter((finding) => {
			if (this.activeFilter !== 'all' && finding.status !== this.activeFilter) {
				return false;
			}

			if (!normalizedSearch) {
				return true;
			}

			const evidencePath = finding.evidence[0]?.filePath?.toLowerCase() ?? '';
			return (
				finding.key.toLowerCase().includes(normalizedSearch) ||
				finding.message.toLowerCase().includes(normalizedSearch) ||
				evidencePath.includes(normalizedSearch)
			);
		});
	}

	get selectedFinding(): Finding | undefined {
		if (!this.isDetailOpen) {
			return undefined;
		}

		if (!this.filteredFindings.length) {
			return undefined;
		}

		return this.filteredFindings.find((finding) => finding.id === this.selectedFindingId) ?? this.filteredFindings[0];
	}

	get allFilterCount(): number {
		return this.findings.length;
	}

	get missingFilterCount(): number {
		return this.findings.filter((finding) => finding.status === 'missing-in-language').length;
	}

	get unusedFilterCount(): number {
		return this.findings.filter((finding) => finding.status === 'unused').length;
	}

	get dynamicFilterCount(): number {
		return this.findings.filter((finding) => finding.status === 'dynamic-uncertain').length;
	}

	get usedFilterCount(): number {
		return this.findings.filter((finding) => finding.status === 'used').length;
	}

	get selectedEvidencePath(): string {
		if (!this.selectedFinding) {
			return 'No source evidence available';
		}

		const firstEvidence = this.selectedFinding.evidence[0];
		if (!firstEvidence) {
			return 'No source evidence available';
		}

		const lineSuffix = firstEvidence.line ? `:${firstEvidence.line}` : '';
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

		const locales = this.matrixLocales;
		if (!locales.length) {
			return [];
		}

		const row = this.scanResult?.translationMatrix?.rows.find((entry) => entry.key === this.selectedFinding?.key);
		if (!row) {
			return locales;
		}

		return locales.filter((locale) => !(row.values[locale] ?? ''));
	}

	get canShowAddToTranslationsAction(): boolean {
		return (
			this.selectedFinding?.status === 'missing-in-language' &&
			!this.isSelectedFindingResolved &&
			this.selectedMissingLocales.length > 0
		);
	}

	get isSelectedFindingResolved(): boolean {
		if (!this.selectedFinding) {
			return false;
		}

		return this.resolvedFindingIds.has(this.selectedFinding.id);
	}

	isResolvedFinding(finding: Finding): boolean {
		return this.resolvedFindingIds.has(finding.id);
	}

	private reconcileResolvedMissingFindings(key: string): void {
		if (!this.scanResult) {
			return;
		}

		const resolvedMissingFindings = this.scanResult.findings.filter(
			(finding) => finding.status === 'missing-in-language' && finding.key === key
		);
		if (!resolvedMissingFindings.length) {
			return;
		}

		for (const finding of resolvedMissingFindings) {
			this.resolvedFindingIds.add(finding.id);
		}

		const existingTimer = this.resolvedRemovalTimers.get(key);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		const timer = setTimeout(() => {
			this.finalizeResolvedMissingFindings(key);
		}, 1600);
		this.resolvedRemovalTimers.set(key, timer);
	}

	private finalizeResolvedMissingFindings(key: string): void {
		if (!this.scanResult) {
			return;
		}

		const resolvedMissingFindings = this.scanResult.findings.filter(
			(finding) => finding.status === 'missing-in-language' && finding.key === key
		);
		if (!resolvedMissingFindings.length) {
			this.resolvedRemovalTimers.delete(key);
			return;
		}

		const remainingFindings = this.scanResult.findings.filter(
			(finding) => !(finding.status === 'missing-in-language' && finding.key === key)
		);

		const summary = this.scanResult.summary;
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

		this.resolvedRemovalTimers.delete(key);
		this.ensureSelectedFinding();
	}

	statusLabel(status: Finding['status']): string {
		if (status === 'missing-in-language') {
			return 'Missing';
		}

		if (status === 'dynamic-uncertain') {
			return 'Dynamic';
		}

		if (status === 'extra-in-language') {
			return 'Extra';
		}

		return status.charAt(0).toUpperCase() + status.slice(1);
	}

	severityLabel(severity: Finding['severity']): string {
		if (severity === 'error') {
			return 'High';
		}

		if (severity === 'warning') {
			return 'Medium';
		}

		return 'Low';
	}

	severityPercent(severity: Finding['severity']): number {
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

		if (
			this.isDetailOpen &&
			(!this.selectedFindingId || !this.filteredFindings.some((finding) => finding.id === this.selectedFindingId))
		) {
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
		const adapterId = this.scanResult?.adapterId ?? 'unknown';
		if (adapterId === 'angular') {
			return 'Angular';
		}

		return adapterId.charAt(0).toUpperCase() + adapterId.slice(1);
	}

	get filesScanned(): number {
		const value = this.scanResult?.metadata?.['usedKeyEvidenceCount'];
		return typeof value === 'number' ? value : 0;
	}

	get scanDurationLabel(): string {
		const durationMs = this.scanResult?.durationMs ?? 0;
		if (durationMs >= 1000) {
			return `${(durationMs / 1000).toFixed(1)}s`;
		}

		return `${durationMs}ms`;
	}

	get localeCount(): number {
		const value = this.scanResult?.metadata?.['translationFileCount'];
		return typeof value === 'number' ? value : 0;
	}

	get topMissingFindings(): Finding[] {
		if (!this.scanResult) {
			return [];
		}

		return this.scanResult.findings
			.filter((finding) => finding.status === 'missing-in-language')
			.slice(0, 5);
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
