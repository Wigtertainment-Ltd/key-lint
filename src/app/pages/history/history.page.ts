import { Component, effect, inject, Injector, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
	ProjectHistoryEvent,
	ScanCompletedHistoryPayload,
	TranslationKeyAddedHistoryPayload
} from '@key-lint/core';
import { ProjectHistoryService } from '../../shared/services/project-history.service';
import { ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';

interface HistoryDayGroup {
	label: string;
	events: ProjectHistoryEvent[];
}

function normalizePath(path: string): string {
	const normalized = path.trim().replaceAll('\\', '/').replace(/\/+/g, '/');
	if (/^[A-Za-z]:\/$/.test(normalized) || normalized === '/') {
		return normalized;
	}

	return normalized.replace(/\/$/, '');
}

@Component({
	selector: 'app-history-page',
	templateUrl: './history.page.html',
	styleUrl: './history.page.scss'
})
export class HistoryPage implements OnInit {
	private readonly route: ActivatedRoute = inject(ActivatedRoute);
	private readonly historyService: ProjectHistoryService = inject(ProjectHistoryService);
	private readonly scanOrchestrationService: ScanOrchestrationService = inject(ScanOrchestrationService);
	private readonly injector: Injector = inject(Injector);
	private readonly projectPathSignal = signal('');
	activeFilter: 'all' | 'scan' | 'translation' = 'all';
	private readonly scanSnapshot = toSignal(this.scanOrchestrationService.state$, {
		initialValue: this.scanOrchestrationService.snapshot
	});
	private readonly events = signal<ProjectHistoryEvent[]>([]);
	private currentWatchedProjectPath = '';

	ngOnInit(): void {
		const routeProjectPath = this.route.snapshot.queryParamMap.get('projectPath') ?? '';
		const scanProjectPath = this.scanOrchestrationService.snapshot.result?.projectRoot ?? '';
		const initialProjectPath = normalizePath(scanProjectPath || routeProjectPath);
		if (initialProjectPath) {
			this.projectPathSignal.set(initialProjectPath);
		}

		effect((onCleanup) => {
			const snapshotPath = normalizePath(this.scanSnapshot().result?.projectRoot ?? '');
			const livePath = snapshotPath || this.projectPathSignal();
			if (!livePath || livePath === this.currentWatchedProjectPath) {
				return;
			}

			this.currentWatchedProjectPath = livePath;
			this.projectPathSignal.set(livePath);

			const subscription = this.historyService.watchEventsForProject(livePath).subscribe((events) => {
				this.events.set(events);
			});

			onCleanup(() => subscription.unsubscribe());
		}, { injector: this.injector });
	}

	setFilter(filter: 'all' | 'scan' | 'translation'): void {
		this.activeFilter = filter;
	}

	get projectPath(): string {
		return this.projectPathSignal();
	}

	get filteredEvents(): ProjectHistoryEvent[] {
		const events = this.events();
		if (this.activeFilter === 'all') {
			return events;
		}

		if (this.activeFilter === 'scan') {
			return events.filter((event) => event.type === 'scan-started' || event.type === 'scan-completed');
		}

		return events.filter((event) => event.type === 'translation-key-added');
	}

	get groupedEvents(): HistoryDayGroup[] {
		const groups = new Map<string, ProjectHistoryEvent[]>();
		for (const event of this.filteredEvents) {
			const date = new Date(event.timestamp);
			const dayKey = Number.isNaN(date.getTime()) ? 'Unknown date' : date.toDateString();
			const bucket = groups.get(dayKey) ?? [];
			bucket.push(event);
			groups.set(dayKey, bucket);
		}

		return Array.from(groups.entries()).map(([label, events]) => ({ label, events }));
	}

	get hasProjectContext(): boolean {
		return Boolean(this.projectPath);
	}

	get hasEvents(): boolean {
		return this.filteredEvents.length > 0;
	}

	formatTime(timestamp: string): string {
		const date = new Date(timestamp);
		if (Number.isNaN(date.getTime())) {
			return 'Unknown time';
		}

		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	eventTitle(event: ProjectHistoryEvent): string {
		if (event.type === 'scan-started') {
			return 'Scan started';
		}

		if (event.type === 'scan-completed') {
			return 'Scan completed';
		}

		return 'Translation key added';
	}

	eventDescription(event: ProjectHistoryEvent): string {
		if (event.type === 'scan-started') {
			return 'A new project scan was started.';
		}

		if (event.type === 'scan-completed') {
			const payload = event.payload as ScanCompletedHistoryPayload;
			return `Adapter ${payload.adapterId} finished in ${Math.max(0, Math.round(payload.durationMs / 1000))}s, ${payload.totalFindings} finding(s), ${payload.totalKeys} key(s), ${payload.localeCount} locale(s).`;
		}

		const payload = event.payload as TranslationKeyAddedHistoryPayload;
		const valueState = payload.valueWasEmpty ? 'empty value' : 'text value';
		return `Key "${payload.key}" was added to locale "${payload.locale}" (${valueState}) from ${payload.source}.`;
	}

	eventMeta(event: ProjectHistoryEvent): string {
		if (event.type !== 'translation-key-added') {
			return this.projectPath;
		}

		const payload = event.payload as TranslationKeyAddedHistoryPayload;
		return payload.filePath;
	}

}
