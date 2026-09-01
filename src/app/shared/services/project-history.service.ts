import { Injectable } from '@angular/core';
import { BehaviorSubject, map, Observable } from 'rxjs';
import { IProjectHistoryEvent, normalizePath, pathDedupeKey, ProjectHistoryPayload, ProjectHistoryEventType } from '@key-lint/core';

interface IStoredProjectHistoryV1 {
	version: 1;
	events: IProjectHistoryEvent[];
}

export interface ICreateIProjectHistoryEventInput<TPayload extends ProjectHistoryPayload = ProjectHistoryPayload> {
	projectPath: string;
	type: ProjectHistoryEventType;
	payload: TPayload;
	timestamp?: string;
}

const PROJECT_HISTORY_STORAGE_KEY = 'key-lint.project-history.v1';
const MAX_EVENTS_PER_PROJECT = 500;

function compareByNewest(a: IProjectHistoryEvent, b: IProjectHistoryEvent): number {
	const left: number = Date.parse(a.timestamp);
	const right: number = Date.parse(b.timestamp);

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
	private readonly eventsSubject: BehaviorSubject<IProjectHistoryEvent[]> = new BehaviorSubject<IProjectHistoryEvent[]>([]);
	private eventCounter: number = 0;

	constructor() {
		this.eventsSubject.next(this.readStoredEvents());
	}

	getEventsForProject(projectPath: string): IProjectHistoryEvent[] {
		const normalizedProjectPath: string = normalizePath(projectPath);
		if (!normalizedProjectPath) {
			return [];
		}

		return this.eventsSubject.getValue()
			.filter((event) => pathDedupeKey(event.projectPath) === pathDedupeKey(normalizedProjectPath))
			.sort(compareByNewest);
	}

	watchEventsForProject(projectPath: string): Observable<IProjectHistoryEvent[]> {
		const normalizedProjectPath: string = normalizePath(projectPath);
		const projectKey: string = pathDedupeKey(normalizedProjectPath);

		return this.eventsSubject.asObservable().pipe(
			map((events) =>
				events
					.filter((event) => pathDedupeKey(event.projectPath) === projectKey)
					.sort(compareByNewest)
			)
		);
	}

	addEvent<TPayload extends ProjectHistoryPayload>(
		input: ICreateIProjectHistoryEventInput<TPayload>
	): IProjectHistoryEvent {
		const normalizedProjectPath: string = normalizePath(input.projectPath);
		if (!normalizedProjectPath) {
			throw new Error('Cannot add history event without a valid project path.');
		}

		const event: IProjectHistoryEvent = {
			id: `${Date.now()}-${++this.eventCounter}`,
			projectPath: normalizedProjectPath,
			timestamp: input.timestamp ?? new Date().toISOString(),
			type: input.type,
			payload: input.payload
		};

		const allEvents: IProjectHistoryEvent[] = this.eventsSubject.getValue();
		const retainedForProject: IProjectHistoryEvent[] = allEvents
			.filter((existing) => pathDedupeKey(existing.projectPath) === pathDedupeKey(normalizedProjectPath))
			.concat(event)
			.sort(compareByNewest)
			.slice(0, MAX_EVENTS_PER_PROJECT);
		const retainedOtherProjects: IProjectHistoryEvent[] = allEvents.filter(
			(existing) => pathDedupeKey(existing.projectPath) !== pathDedupeKey(normalizedProjectPath)
		);
		const nextEvents = retainedOtherProjects.concat(retainedForProject);

		this.replaceEvents(nextEvents);
		return event;
	}

	clearProjectHistory(projectPath: string): void {
		const normalizedProjectPath: string = normalizePath(projectPath);
		if (!normalizedProjectPath) {
			return;
		}

		const filtered: IProjectHistoryEvent[] = this.eventsSubject.getValue().filter(
			(event) => pathDedupeKey(event.projectPath) !== pathDedupeKey(normalizedProjectPath)
		);

		this.replaceEvents(filtered);
	}

	private replaceEvents(nextEvents: IProjectHistoryEvent[]): void {
		this.eventsSubject.next(nextEvents);
		this.writeStoredEvents(nextEvents);
	}

	private readStoredEvents(): IProjectHistoryEvent[] {
		try {
			const raw: string = localStorage.getItem(PROJECT_HISTORY_STORAGE_KEY);
			if (!raw) {
				return [];
			}

			const parsed: unknown = JSON.parse(raw) as unknown;
			if (!parsed || typeof parsed !== 'object') {
				return [];
			}

			const payload: Partial<IStoredProjectHistoryV1> = parsed as Partial<IStoredProjectHistoryV1>;
			if (payload.version !== 1 || !Array.isArray(payload.events)) {
				return [];
			}

			return payload.events
				.filter((event): event is IProjectHistoryEvent =>
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

	private writeStoredEvents(events: IProjectHistoryEvent[]): void {
		const payload: IStoredProjectHistoryV1 = {
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
