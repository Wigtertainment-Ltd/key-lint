import { Injectable } from '@angular/core';
import { BehaviorSubject, map, Observable } from 'rxjs';
import { ProjectHistoryEvent, ProjectHistoryPayload, ProjectHistoryEventType } from '@check-i18n/core';

interface StoredProjectHistoryV1 {
	version: 1;
	events: ProjectHistoryEvent[];
}

export interface CreateProjectHistoryEventInput<TPayload extends ProjectHistoryPayload = ProjectHistoryPayload> {
	projectPath: string;
	type: ProjectHistoryEventType;
	payload: TPayload;
	timestamp?: string;
}

const PROJECT_HISTORY_STORAGE_KEY = 'check-i18n.project-history.v1';
const MAX_EVENTS_PER_PROJECT = 500;

function normalizePath(path: string): string {
	const normalized = path.trim().replaceAll('\\', '/').replace(/\/+/g, '/');
	if (/^[A-Za-z]:\/$/.test(normalized) || normalized === '/') {
		return normalized;
	}

	return normalized.replace(/\/$/, '');
}

function dedupeKey(path: string): string {
	return normalizePath(path).toLowerCase();
}

function compareByNewest(a: ProjectHistoryEvent, b: ProjectHistoryEvent): number {
	const left = Date.parse(a.timestamp);
	const right = Date.parse(b.timestamp);

	if (!Number.isNaN(left) && !Number.isNaN(right)) {
		return right - left;
	}

	if (!Number.isNaN(left)) {
		return -1;
	}

	if (!Number.isNaN(right)) {
		return 1;
	}

	return b.timestamp.localeCompare(a.timestamp);
}

@Injectable({
	providedIn: 'root'
})
export class ProjectHistoryService {
	private readonly eventsSubject = new BehaviorSubject<ProjectHistoryEvent[]>([]);
	private eventCounter = 0;

	constructor() {
		this.eventsSubject.next(this.readStoredEvents());
	}

	getEventsForProject(projectPath: string): ProjectHistoryEvent[] {
		const normalizedProjectPath = normalizePath(projectPath);
		if (!normalizedProjectPath) {
			return [];
		}

		return this.eventsSubject.getValue()
			.filter((event) => dedupeKey(event.projectPath) === dedupeKey(normalizedProjectPath))
			.sort(compareByNewest);
	}

	watchEventsForProject(projectPath: string): Observable<ProjectHistoryEvent[]> {
		const normalizedProjectPath = normalizePath(projectPath);
		const projectKey = dedupeKey(normalizedProjectPath);

		return this.eventsSubject.asObservable().pipe(
			map((events) =>
				events
					.filter((event) => dedupeKey(event.projectPath) === projectKey)
					.sort(compareByNewest)
			)
		);
	}

	addEvent<TPayload extends ProjectHistoryPayload>(
		input: CreateProjectHistoryEventInput<TPayload>
	): ProjectHistoryEvent {
		const normalizedProjectPath = normalizePath(input.projectPath);
		if (!normalizedProjectPath) {
			throw new Error('Cannot add history event without a valid project path.');
		}

		const event: ProjectHistoryEvent = {
			id: `${Date.now()}-${++this.eventCounter}`,
			projectPath: normalizedProjectPath,
			timestamp: input.timestamp ?? new Date().toISOString(),
			type: input.type,
			payload: input.payload
		};

		const allEvents = this.eventsSubject.getValue();
		const retainedForProject = allEvents
			.filter((existing) => dedupeKey(existing.projectPath) === dedupeKey(normalizedProjectPath))
			.concat(event)
			.sort(compareByNewest)
			.slice(0, MAX_EVENTS_PER_PROJECT);
		const retainedOtherProjects = allEvents.filter(
			(existing) => dedupeKey(existing.projectPath) !== dedupeKey(normalizedProjectPath)
		);
		const nextEvents = retainedOtherProjects.concat(retainedForProject);

		this.replaceEvents(nextEvents);
		return event;
	}

	clearProjectHistory(projectPath: string): void {
		const normalizedProjectPath = normalizePath(projectPath);
		if (!normalizedProjectPath) {
			return;
		}

		const filtered = this.eventsSubject.getValue().filter(
			(event) => dedupeKey(event.projectPath) !== dedupeKey(normalizedProjectPath)
		);

		this.replaceEvents(filtered);
	}

	private replaceEvents(nextEvents: ProjectHistoryEvent[]): void {
		this.eventsSubject.next(nextEvents);
		this.writeStoredEvents(nextEvents);
	}

	private readStoredEvents(): ProjectHistoryEvent[] {
		try {
			const raw = localStorage.getItem(PROJECT_HISTORY_STORAGE_KEY);
			if (!raw) {
				return [];
			}

			const parsed = JSON.parse(raw) as unknown;
			if (!parsed || typeof parsed !== 'object') {
				return [];
			}

			const payload = parsed as Partial<StoredProjectHistoryV1>;
			if (payload.version !== 1 || !Array.isArray(payload.events)) {
				return [];
			}

			return payload.events
				.filter((event): event is ProjectHistoryEvent =>
					Boolean(
						event &&
						typeof event.id === 'string' &&
						typeof event.projectPath === 'string' &&
						typeof event.timestamp === 'string' &&
						typeof event.type === 'string' &&
						event.payload !== undefined
					)
				)
				.map((event) => ({
					...event,
					projectPath: normalizePath(event.projectPath)
				}))
				.filter((event) => Boolean(event.projectPath));
		} catch {
			return [];
		}
	}

	private writeStoredEvents(events: ProjectHistoryEvent[]): void {
		const payload: StoredProjectHistoryV1 = {
			version: 1,
			events
		};

		try {
			localStorage.setItem(PROJECT_HISTORY_STORAGE_KEY, JSON.stringify(payload));
		} catch {
			// Ignore storage failures so scanning and translation updates keep working.
		}
	}
}
