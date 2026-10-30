import { Injector } from '@angular/core';
import { ElectronService } from './electron.service';
import { RecentProjectsService, IRecentProjectItem } from './recent-projects.service';

function electronMock(isElectron: boolean, existingPaths: string[] = []): ElectronService {
	return {
		isElectron,
		pathExists: async (path: string): Promise<boolean> => Promise.resolve(existingPaths.includes(path))
	} as unknown as ElectronService;
}

function createService(electronService: ElectronService): RecentProjectsService {
	return Injector.create({ providers: [RecentProjectsService, { provide: ElectronService, useValue: electronService }] }).get(RecentProjectsService);
}

describe('RecentProjectsService', (): void => {
	beforeEach((): void => localStorage.clear());
	afterEach((): void => localStorage.clear());

	it('normalizes, deduplicates case-insensitively, and moves a project to the front', async (): Promise<void> => {
		const service: RecentProjectsService = createService(electronMock(false));
		service.addRecentProject('C:\\Work\\App\\');
		service.addRecentProject('C:/Work/Other');
		service.addRecentProject('c:/work/app');

		expect((await service.getRecentProjects()).map((project: IRecentProjectItem): string => project.path)).toEqual([
			'c:/work/app',
			'C:/Work/Other'
		]);
	});

	it('keeps only the five most recent projects', async (): Promise<void> => {
		const service: RecentProjectsService = createService(electronMock(false));
		for (let index: number = 1; index <= 6; index += 1) {
			service.addRecentProject(`/project/${index}`);
		}

		expect((await service.getRecentProjects()).map((project: IRecentProjectItem): string => project.path)).toEqual([
			'/project/6', '/project/5', '/project/4', '/project/3', '/project/2'
		]);
	});

	it('checks filesystem existence in Electron and assumes availability in a browser', async (): Promise<void> => {
		localStorage.setItem('key-lint.recent-projects', JSON.stringify(['/exists', '/missing']));

		expect(await createService(electronMock(true, ['/exists'])).getRecentProjects()).toEqual([
			{ path: '/exists', exists: true },
			{ path: '/missing', exists: false }
		]);
		expect((await createService(electronMock(false)).getRecentProjects()).every((item: IRecentProjectItem): boolean => item.exists)).toBeTrue();
	});

	it('removes projects and tolerates malformed storage', async (): Promise<void> => {
		localStorage.setItem('key-lint.recent-projects', '{invalid json');
		const service: RecentProjectsService = createService(electronMock(false));
		expect(await service.getRecentProjects()).toEqual([]);

		service.addRecentProject('/one');
		service.addRecentProject('/two');
		service.removeRecentProject('/ONE');
		expect((await service.getRecentProjects()).map((project: IRecentProjectItem): string => project.path)).toEqual(['/two']);
	});
});
