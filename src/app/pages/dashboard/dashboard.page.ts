import { Component, computed, effect, inject, Injector, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ScanCompletedHistoryPayload, ProjectScanResult } from '@key-lint/core';
import { ProjectHistoryService } from '../../shared/services/project-history.service';
import { ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';

interface TrendBar {
	id: string;
	label: string;
	keys: number;
	issues: number;
	dayKey: string;
	timestamp: string;
	isLatest?: boolean;
}

@Component({
	selector: 'app-dashboard-page',
	imports: [DecimalPipe],
	templateUrl: './dashboard.page.html',
	styleUrl: './dashboard.page.scss'
})
export class DashboardPage implements OnInit {
	private readonly scanOrchestrationService: ScanOrchestrationService = inject(ScanOrchestrationService);
	private readonly historyService: ProjectHistoryService = inject(ProjectHistoryService);
	private readonly route: ActivatedRoute = inject(ActivatedRoute);
	private readonly router: Router = inject(Router);
	private readonly injector: Injector = inject(Injector);
	private readonly scanSnapshot = toSignal(this.scanOrchestrationService.state$, {
		initialValue: this.scanOrchestrationService.snapshot
	});
	private readonly scanResultSignal = computed(() => this.scanSnapshot().result);
	private watchedProjectPath = '';
	private readonly scanTrendEvents = signal<TrendBar[]>([]);
	private readonly selectedTrendDayKey = signal<string | undefined>(undefined);

	ngOnInit(): void {
		effect((onCleanup) => {
			const normalizedProjectRoot = this.resolveProjectRoot();
			if (!normalizedProjectRoot || normalizedProjectRoot === this.watchedProjectPath) {
				return;
			}

			this.watchedProjectPath = normalizedProjectRoot;
			const subscription = this.historyService.watchEventsForProject(normalizedProjectRoot).subscribe((events) => {
				const selected: TrendBar[] = [];
				for (const event of events) {
					if (event.type !== 'scan-completed') {
						continue;
					}

					const eventTime = new Date(event.timestamp);
					if (Number.isNaN(eventTime.getTime())) {
						continue;
					}

					const dayKey = this.toDayKey(eventTime);
					const payload = event.payload as ScanCompletedHistoryPayload;
					const hasDetailedIssueCounts =
						typeof payload.missingCount === 'number' || typeof payload.unusedCount === 'number';
					const missingCount = typeof payload.missingCount === 'number' ? payload.missingCount : 0;
					const unusedCount = typeof payload.unusedCount === 'number' ? payload.unusedCount : 0;
					const issues = hasDetailedIssueCounts
						? Math.max(0, missingCount + unusedCount)
						: Math.max(0, payload.totalFindings);

					selected.push({
						id: event.id,
						label: this.formatTrendLabel(event.timestamp),
						keys: payload.totalKeys,
						issues,
						dayKey,
						timestamp: event.timestamp
					});
				}

				selected.sort((left, right) => this.timestampToMillis(right.timestamp) - this.timestampToMillis(left.timestamp));
				this.scanTrendEvents.set(selected);

				const activeDay = this.selectedTrendDayKey();
				if (activeDay && !selected.some((scan) => scan.dayKey === activeDay)) {
					this.selectedTrendDayKey.set(undefined);
				}
			});

			onCleanup(() => subscription.unsubscribe());
		}, { injector: this.injector });

		if (!this.scanResultSignal()) {
			void this.router.navigate(['/scan-progress']);
		}
	}

	private get scanResult(): ProjectScanResult | undefined {
		return this.scanResultSignal();
	}

	openMissingKeys(): void {
		void this.router.navigate(['/analysis/results']);
	}

	openUnusedKeys(): void {
		void this.router.navigate(['/analysis/results']);
	}

	openTranslationKeys(): void {
		void this.router.navigate(['/analysis/translation-keys']);
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

	get issueCount(): number {
		return this.missingKeys + this.unusedKeys;
	}

	get criticalTitle(): string {
		if (this.missingKeys > 0) {
			return 'Critical Issues Detected';
		}

		return 'No Critical Translation Breaks';
	}

	get criticalDescription(): string {
		if (this.missingKeys === 0) {
			return 'No missing keys found in the current scan. Translation lookup coverage is stable.';
		}

		return `${this.missingKeys} missing key(s) found. These keys are referenced in source code but missing in locale files.`;
	}

	get optimizationDescription(): string {
		if (this.totalKeys === 0) {
			return 'No keys available yet. Start by scanning a project with translation files.';
		}

		return `${this.unusedPercent}% of your keys (${this.unusedKeys}) are currently unused. Pruning these keys can reduce bundle size.`;
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

	get localeLabels(): string[] {
		return this.scanResult?.translationMatrix?.locales ?? [];
	}

	get trendBars(): TrendBar[] {
		const drilldownBars = this.buildDrilldownTrendBars();
		if (drilldownBars) {
			return drilldownBars;
		}

		const overviewBars = this.buildOverviewTrendBars();
		if (overviewBars.length > 0) {
			return overviewBars;
		}

		return this.buildFallbackTrendBars();
	}

	get isTrendDrilldown(): boolean {
		return Boolean(this.selectedTrendDayKey());
	}

	get trendViewLabel(): string {
		const selectedDayKey = this.selectedTrendDayKey();
		if (!selectedDayKey) {
			return 'Last 5 scan days';
		}

		const activeDay = this.trendBars[0]?.timestamp;
		if (!activeDay) {
			return 'Selected day scans';
		}

		const date = new Date(activeDay);
		if (Number.isNaN(date.getTime())) {
			return 'Selected day scans';
		}

		return date.toLocaleDateString([], {
			weekday: 'long',
			month: 'short',
			day: '2-digit'
		});
	}

	get trendGridTemplateColumns(): string {
		const columnCount = Math.max(this.trendBars.length, 1);
		return `repeat(${columnCount}, minmax(0, 1fr))`;
	}

	barHeightPercent(value: number): number {
		if (this.maxTrendMetric <= 0) {
			return 10;
		}

		return Math.max(10, Math.round((value / this.maxTrendMetric) * 100));
	}

	trackTrendBar(_: number, bar: TrendBar): string {
		return bar.id;
	}

	onTrendBarClick(bar: TrendBar): void {
		if (this.isTrendDrilldown) {
			return;
		}

		this.selectedTrendDayKey.set(bar.dayKey);
	}

	closeTrendDrilldown(): void {
		this.selectedTrendDayKey.set(undefined);
	}

	private get unusedPercent(): number {
		if (this.totalKeys === 0) {
			return 0;
		}

		return Math.round((this.unusedKeys / this.totalKeys) * 100);
	}

	private get maxTrendMetric(): number {
		let maxValue = 0;
		for (const bar of this.trendBars) {
			maxValue = Math.max(maxValue, bar.keys, bar.issues);
		}

		return Math.max(maxValue, 1);
	}

	private resolveProjectRoot(): string {
		const snapshotProjectRoot = this.scanResult?.projectRoot ?? '';
		const queryProjectRoot = this.route.snapshot.queryParamMap.get('projectPath') ?? '';
		return this.normalizePath(snapshotProjectRoot || queryProjectRoot);
	}

	private buildDrilldownTrendBars(): TrendBar[] | undefined {
		const selectedDayKey = this.selectedTrendDayKey();
		if (!this.isTrendDrilldown || !selectedDayKey) {
			return undefined;
		}

		const dayScans = this.scanTrendEvents().filter((item) => item.dayKey === selectedDayKey);
		const chronologicallySorted = [...dayScans].sort(
			(left, right) => this.timestampToMillis(left.timestamp) - this.timestampToMillis(right.timestamp)
		);

		if (chronologicallySorted.length === 0) {
			this.selectedTrendDayKey.set(undefined);
			return undefined;
		}

		const latestTenScans = chronologicallySorted.slice(-10);

		return latestTenScans.map((item) => ({
			...item,
			label: this.formatTrendTimeLabel(item.timestamp),
			isLatest: false
		}));
	}

	private buildOverviewTrendBars(): TrendBar[] {
		const trendEvents = this.scanTrendEvents();
		if (trendEvents.length === 0) {
			return [];
		}

		const seenDays = new Set<string>();
		const latestPerDay: TrendBar[] = [];

		for (const scan of trendEvents) {
			if (seenDays.has(scan.dayKey)) {
				continue;
			}

			seenDays.add(scan.dayKey);
			latestPerDay.push({
				...scan,
				label: this.formatTrendLabel(scan.timestamp),
				isLatest: false
			});

			if (latestPerDay.length === 5) {
				break;
			}
		}

		const chronologicallyOrdered = [...latestPerDay].reverse();
		const latestBar = chronologicallyOrdered.at(-1);
		if (latestBar) {
			latestBar.isLatest = true;
		}

		return chronologicallyOrdered;
	}

	private buildFallbackTrendBars(): TrendBar[] {
		if (!this.scanResult) {
			return [];
		}

		const scanTimestamp = this.scanResult.finishedAt;
		return [
			{
				id: `fallback-${scanTimestamp}`,
				label: this.formatTrendLabel(scanTimestamp),
				keys: this.totalKeys,
				issues: this.missingKeys + this.unusedKeys,
				dayKey: this.toDayKey(new Date(scanTimestamp)),
				timestamp: scanTimestamp,
				isLatest: true
			}
		];
	}

	private toDayKey(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	private formatTrendLabel(timestamp: string): string {
		const date = new Date(timestamp);
		if (Number.isNaN(date.getTime())) {
			return 'Unknown';
		}

		return date.toLocaleDateString([], {
			month: 'short',
			day: '2-digit'
		});
	}

	private formatTrendTimeLabel(timestamp: string): string {
		const date = new Date(timestamp);
		if (Number.isNaN(date.getTime())) {
			return 'Unknown';
		}

		return date.toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	private normalizePath(path: string): string {
		let normalized = path.trim().replaceAll('\\', '/').replace(/\/+/g, '/');
		if (!normalized) {
			return normalized;
		}

		if (normalized !== '/' && !/^[A-Za-z]:\/$/.test(normalized)) {
			normalized = normalized.replace(/\/$/, '');
		}

		return normalized;
	}

	private timestampToMillis(timestamp: string): number {
		const parsed = Date.parse(timestamp);
		if (!Number.isNaN(parsed)) {
			return parsed;
		}

		return 0;
	}
}
