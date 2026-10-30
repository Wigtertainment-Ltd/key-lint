import { Component, computed, effect, inject, Injector, OnInit, signal, Signal, WritableSignal, EffectCleanupRegisterFn } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IScanCompletedHistoryPayload, IProjectScanResult, normalizePath, IProjectHistoryEvent } from '@key-lint/core';
import { ProjectHistoryService } from '../../shared/services/project-history.service';
import { ScanOrchestrationService, ScanExecutionSnapshot } from '../../shared/services/scan-orchestration.service';
import { ITrendBar } from './dashboard.interfaces';
import type { Subscription } from 'rxjs';

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
	private readonly scanSnapshot: Signal<ScanExecutionSnapshot> = toSignal(this.scanOrchestrationService.state$, {
		initialValue: this.scanOrchestrationService.snapshot
	});
	private readonly scanResultSignal: Signal<IProjectScanResult | undefined> = computed((): IProjectScanResult | undefined => this.scanSnapshot().result);
	private watchedProjectPath: string = '';
	private readonly scanTrendEvents: WritableSignal<ITrendBar[]> = signal<ITrendBar[]>([]);
	private readonly selectedTrendDayKey: WritableSignal<string | undefined> = signal<string | undefined>(undefined);

	ngOnInit(): void {
		effect(
			(onCleanup: EffectCleanupRegisterFn): void => {
				const normalizedProjectRoot: string = this.resolveProjectRoot();
				if (!normalizedProjectRoot || normalizedProjectRoot === this.watchedProjectPath) {
					return;
				}

				this.watchedProjectPath = normalizedProjectRoot;
				const subscription: Subscription = this.historyService.watchEventsForProject(normalizedProjectRoot).subscribe((events: IProjectHistoryEvent[]): void => {
					const selected: ITrendBar[] = [];
					for (const event of events) {
						if (event.type !== 'scan-completed') {
							continue;
						}

						const eventTime: Date = new Date(event.timestamp);
						if (Number.isNaN(eventTime.getTime())) {
							continue;
						}

						const dayKey: string = this.toDayKey(eventTime);
						const payload: IScanCompletedHistoryPayload = event.payload as IScanCompletedHistoryPayload;
						const hasDetailedIssueCounts: boolean = typeof payload.missingCount === 'number' || typeof payload.unusedCount === 'number';
						const missingCount: number = typeof payload.missingCount === 'number' ? payload.missingCount : 0;
						const unusedCount: number = typeof payload.unusedCount === 'number' ? payload.unusedCount : 0;
						const placeholderIssueCount: number = typeof payload.placeholderIssueCount === 'number' ? payload.placeholderIssueCount : 0;
						const issues: number = hasDetailedIssueCounts ? Math.max(0, missingCount + unusedCount + placeholderIssueCount) : Math.max(0, payload.totalFindings);

						selected.push({
							id: event.id,
							label: this.formatTrendLabel(event.timestamp),
							keys: payload.totalKeys,
							issues,
							dayKey,
							timestamp: event.timestamp
						});
					}

					selected.sort((left: ITrendBar, right: ITrendBar): number => this.timestampToMillis(right.timestamp) - this.timestampToMillis(left.timestamp));
					this.scanTrendEvents.set(selected);

					const activeDay: string | undefined = this.selectedTrendDayKey();
					if (activeDay && !selected.some((scan: ITrendBar): boolean => scan.dayKey === activeDay)) {
						this.selectedTrendDayKey.set(undefined);
					}
				});

				onCleanup((): void => subscription.unsubscribe());
			},
			{ injector: this.injector }
		);

		if (!this.scanResultSignal()) {
			void this.router.navigate(['/scan-progress']);
		}
	}

	private get scanResult(): IProjectScanResult | undefined {
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

	get placeholderIssues(): number {
		return (this.scanResult?.summary.placeholderMissing ?? 0) + (this.scanResult?.summary.placeholderMismatch ?? 0);
	}

	get issueCount(): number {
		return this.missingKeys + this.unusedKeys + this.placeholderIssues;
	}

	get criticalTitle(): string {
		if (this.missingKeys > 0 || this.placeholderIssues > 0) {
			return 'Critical Issues Detected';
		}

		return 'No Critical Translation Breaks';
	}

	get criticalDescription(): string {
		if (this.missingKeys === 0 && this.placeholderIssues === 0) {
			return 'No missing translations or placeholder contract errors found in the current scan.';
		}

		return `${this.missingKeys} missing translation(s) and ${this.placeholderIssues} placeholder contract error(s) found.`;
	}

	get optimizationDescription(): string {
		if (this.totalKeys === 0) {
			return 'No keys available yet. Start by scanning a project with translation files.';
		}

		return `${this.unusedPercent}% of your keys (${this.unusedKeys}) are currently unused. Pruning these keys can reduce bundle size.`;
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

	get localeLabels(): string[] {
		return this.scanResult?.translationMatrix?.locales ?? [];
	}

	get trendBars(): ITrendBar[] {
		const drilldownBars: ITrendBar[] | undefined = this.buildDrilldownTrendBars();
		if (drilldownBars) {
			return drilldownBars;
		}

		const overviewBars: ITrendBar[] = this.buildOverviewTrendBars();
		if (overviewBars.length > 0) {
			return overviewBars;
		}

		return this.buildFallbackTrendBars();
	}

	get isTrendDrilldown(): boolean {
		return Boolean(this.selectedTrendDayKey());
	}

	get trendViewLabel(): string {
		const selectedDayKey: string | undefined = this.selectedTrendDayKey();
		if (!selectedDayKey) {
			return 'Last 5 scan days';
		}

		const activeDay: string = this.trendBars[0]?.timestamp;
		if (!activeDay) {
			return 'Selected day scans';
		}

		const date: Date = new Date(activeDay);
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
		const columnCount: number = Math.max(this.trendBars.length, 1);
		return `repeat(${columnCount}, minmax(0, 1fr))`;
	}

	barHeightPercent(value: number): number {
		if (this.maxTrendMetric <= 0) {
			return 10;
		}

		return Math.max(10, Math.round((value / this.maxTrendMetric) * 100));
	}

	trackTrendBar(_: number, bar: ITrendBar): string {
		return bar.id;
	}

	onTrendBarClick(bar: ITrendBar): void {
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
		let maxValue: number = 0;
		for (const bar of this.trendBars) {
			maxValue = Math.max(maxValue, bar.keys, bar.issues);
		}

		return Math.max(maxValue, 1);
	}

	private resolveProjectRoot(): string {
		const snapshotProjectRoot: string = this.scanResult?.projectRoot ?? '';
		const queryProjectRoot: string = this.route.snapshot.queryParamMap.get('projectPath') ?? '';
		return normalizePath(snapshotProjectRoot || queryProjectRoot);
	}

	private buildDrilldownTrendBars(): ITrendBar[] | undefined {
		const selectedDayKey: string | undefined = this.selectedTrendDayKey();
		if (!this.isTrendDrilldown || !selectedDayKey) {
			return undefined;
		}

		const dayScans: ITrendBar[] = this.scanTrendEvents().filter((item: ITrendBar): boolean => item.dayKey === selectedDayKey);
		const chronologicallySorted: ITrendBar[] = [...dayScans].sort(
			(left: ITrendBar, right: ITrendBar): number => this.timestampToMillis(left.timestamp) - this.timestampToMillis(right.timestamp)
		);

		if (chronologicallySorted.length === 0) {
			this.selectedTrendDayKey.set(undefined);
			return undefined;
		}

		const latestTenScans: ITrendBar[] = chronologicallySorted.slice(-10);

		return latestTenScans.map((item: ITrendBar): { label: string; isLatest: false; id: string; keys: number; issues: number; dayKey: string; timestamp: string; } => ({
			...item,
			label: this.formatTrendTimeLabel(item.timestamp),
			isLatest: false
		}));
	}

	private buildOverviewTrendBars(): ITrendBar[] {
		const trendEvents: ITrendBar[] = this.scanTrendEvents();
		if (trendEvents.length === 0) {
			return [];
		}

		const seenDays: Set<string> = new Set<string>();
		const latestPerDay: ITrendBar[] = [];

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

		const chronologicallyOrdered: ITrendBar[] = [...latestPerDay].reverse();
		const latestBar: ITrendBar | undefined = chronologicallyOrdered.at(-1);
		if (latestBar) {
			latestBar.isLatest = true;
		}

		return chronologicallyOrdered;
	}

	private buildFallbackTrendBars(): ITrendBar[] {
		if (!this.scanResult) {
			return [];
		}

		const scanTimestamp: string = this.scanResult.finishedAt;
		return [
			{
				id: `fallback-${scanTimestamp}`,
				label: this.formatTrendLabel(scanTimestamp),
				keys: this.totalKeys,
				issues: this.issueCount,
				dayKey: this.toDayKey(new Date(scanTimestamp)),
				timestamp: scanTimestamp,
				isLatest: true
			}
		];
	}

	private toDayKey(date: Date): string {
		const year: number = date.getFullYear();
		const month: string = String(date.getMonth() + 1).padStart(2, '0');
		const day: string = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	private formatTrendLabel(timestamp: string): string {
		const date: Date = new Date(timestamp);
		if (Number.isNaN(date.getTime())) {
			return 'Unknown';
		}

		return date.toLocaleDateString([], {
			month: 'short',
			day: '2-digit'
		});
	}

	private formatTrendTimeLabel(timestamp: string): string {
		const date: Date = new Date(timestamp);
		if (Number.isNaN(date.getTime())) {
			return 'Unknown';
		}

		return date.toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	private timestampToMillis(timestamp: string): number {
		const parsed: number = Date.parse(timestamp);
		if (!Number.isNaN(parsed)) {
			return parsed;
		}

		return 0;
	}
}
