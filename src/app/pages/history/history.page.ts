import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import {
	ProjectHistoryEvent,
	ScanCompletedHistoryPayload,
	TranslationKeyAddedHistoryPayload
} from '../../core/models/history-event.model';
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
	standalone: true,
	templateUrl: './history.page.html',
	styleUrl: './history.page.scss'
})
export class HistoryPage implements OnInit, OnDestroy {
	projectPath = '';
	activeFilter: 'all' | 'scan' | 'translation' = 'all';
	private historySubscription?: Subscription;
	private stateSubscription?: Subscription;
	private currentWatchedProjectPath = '';
	private events: ProjectHistoryEvent[] = [];

	constructor(
		private readonly route: ActivatedRoute,
		private readonly historyService: ProjectHistoryService,
		private readonly scanOrchestrationService: ScanOrchestrationService
	) {}

	ngOnInit(): void {
		const routeProjectPath = this.route.snapshot.queryParamMap.get('projectPath') ?? '';
		const scanProjectPath = this.scanOrchestrationService.snapshot.result?.projectRoot ?? '';
		const initialProjectPath = normalizePath(scanProjectPath || routeProjectPath);
		if (initialProjectPath) {
			this.watchProject(initialProjectPath);
		}

		this.stateSubscription = this.scanOrchestrationService.state$.subscribe((snapshot) => {
			const livePath = normalizePath(snapshot.result?.projectRoot ?? '');
			if (!livePath || livePath === this.currentWatchedProjectPath) {
				return;
			}

			this.watchProject(livePath);
		});
	}

	ngOnDestroy(): void {
		this.historySubscription?.unsubscribe();
		this.stateSubscription?.unsubscribe();
	}

	setFilter(filter: 'all' | 'scan' | 'translation'): void {
		this.activeFilter = filter;
	}

	get filteredEvents(): ProjectHistoryEvent[] {
		if (this.activeFilter === 'all') {
			return this.events;
		}

		if (this.activeFilter === 'scan') {
			return this.events.filter((event) => event.type === 'scan-started' || event.type === 'scan-completed');
		}

		return this.events.filter((event) => event.type === 'translation-key-added');
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

	private watchProject(projectPath: string): void {
		this.projectPath = projectPath;
		this.currentWatchedProjectPath = projectPath;
		this.historySubscription?.unsubscribe();
		this.historySubscription = this.historyService
			.watchEventsForProject(projectPath)
			.subscribe((events) => {
				this.events = events;
			});
	}
}
