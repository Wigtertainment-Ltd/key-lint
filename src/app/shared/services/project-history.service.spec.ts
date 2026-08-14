import { ProjectHistoryService } from './project-history.service';

describe('ProjectHistoryService', () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => localStorage.clear());

	it('normalizes project paths, isolates projects, and orders newest events first', () => {
		const service = new ProjectHistoryService();
		service.addEvent({
			projectPath: 'C:\\Work\\App\\',
			type: 'scan-started',
			timestamp: '2026-01-01T10:00:00.000Z',
			payload: { requestedProjectRoot: 'C:/Work/App' }
		});
		service.addEvent({
			projectPath: 'c:/work/app',
			type: 'scan-completed',
			timestamp: '2026-01-02T10:00:00.000Z',
			payload: {
				adapterId: 'angular',
				durationMs: 1000,
				totalFindings: 1,
				totalKeys: 10,
				localeCount: 2
			}
		});
		service.addEvent({
			projectPath: 'C:/Work/Other',
			type: 'scan-started',
			payload: { requestedProjectRoot: 'C:/Work/Other' }
		});

		const events = service.getEventsForProject('C:/WORK/APP/');
		expect(events.map((event) => event.type)).toEqual(['scan-completed', 'scan-started']);
		expect(events.every((event) => event.projectPath.toLowerCase() === 'c:/work/app')).toBeTrue();
	});

	it('persists events and restores them in a new service instance', () => {
		const first = new ProjectHistoryService();
		first.addEvent({
			projectPath: '/workspace/app',
			type: 'translation-key-added',
			payload: {
				locale: 'de',
				key: 'APP.TITLE',
				filePath: '/workspace/app/de.json',
				valueWasEmpty: false,
				source: 'translation-keys'
			}
		});

		const restored = new ProjectHistoryService().getEventsForProject('/workspace/app');
		expect(restored).toHaveSize(1);
		expect(restored[0].payload).toEqual(jasmine.objectContaining({ locale: 'de', key: 'APP.TITLE' }));
	});

	it('keeps at most 500 events per project without deleting other projects', () => {
		const service = new ProjectHistoryService();
		for (let index = 0; index < 501; index += 1) {
			service.addEvent({
				projectPath: '/workspace/main',
				type: 'scan-started',
				timestamp: new Date(index * 1000).toISOString(),
				payload: { requestedProjectRoot: '/workspace/main' }
			});
		}
		service.addEvent({
			projectPath: '/workspace/other',
			type: 'scan-started',
			payload: { requestedProjectRoot: '/workspace/other' }
		});

		expect(service.getEventsForProject('/workspace/main')).toHaveSize(500);
		expect(service.getEventsForProject('/workspace/other')).toHaveSize(1);
	});

	it('clears only the selected project and tolerates malformed storage', () => {
		localStorage.setItem('key-lint.project-history.v1', '{invalid json');
		const service = new ProjectHistoryService();
		expect(service.getEventsForProject('/workspace/main')).toEqual([]);

		service.addEvent({
			projectPath: '/workspace/main',
			type: 'scan-started',
			payload: { requestedProjectRoot: '/workspace/main' }
		});
		service.addEvent({
			projectPath: '/workspace/other',
			type: 'scan-started',
			payload: { requestedProjectRoot: '/workspace/other' }
		});
		service.clearProjectHistory('/workspace/main');

		expect(service.getEventsForProject('/workspace/main')).toEqual([]);
		expect(service.getEventsForProject('/workspace/other')).toHaveSize(1);
	});
});
