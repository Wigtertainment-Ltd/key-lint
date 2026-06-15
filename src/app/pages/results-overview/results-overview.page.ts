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
	}

	closeDetailPanel(): void {
		this.isDetailOpen = false;
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
