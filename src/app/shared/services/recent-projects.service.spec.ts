import { ElectronService } from './electron.service';
import { RecentProjectsService } from './recent-projects.service';

function electronMock(isElectron: boolean, existingPaths: string[] = []): ElectronService {
	return {
		isElectron,
		fs: {
			existsSync: (path: string) => existingPaths.includes(path)
		}
	} as unknown as ElectronService;
}

describe('RecentProjectsService', () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => localStorage.clear());

	it('normalizes, deduplicates case-insensitively, and moves a project to the front', () => {
		const service = new RecentProjectsService(electronMock(false));
		service.addRecentProject('C:\\Work\\App\\');
		service.addRecentProject('C:/Work/Other');
		service.addRecentProject('c:/work/app');

		expect(service.getRecentProjects().map((project) => project.path)).toEqual([
			'c:/work/app',
			'C:/Work/Other'
		]);
	});

	it('keeps only the five most recent projects', () => {
		const service = new RecentProjectsService(electronMock(false));
		for (let index = 1; index <= 6; index += 1) {
			service.addRecentProject(`/project/${index}`);
		}

		expect(service.getRecentProjects().map((project) => project.path)).toEqual([
			'/project/6', '/project/5', '/project/4', '/project/3', '/project/2'
		]);
	});

	it('checks filesystem existence in Electron and assumes availability in a browser', () => {
		localStorage.setItem('key-lint.recent-projects', JSON.stringify(['/exists', '/missing']));

		expect(new RecentProjectsService(electronMock(true, ['/exists'])).getRecentProjects()).toEqual([
			{ path: '/exists', exists: true },
			{ path: '/missing', exists: false }
		]);
		expect(new RecentProjectsService(electronMock(false)).getRecentProjects().every((item) => item.exists)).toBeTrue();
	});

	it('removes projects and tolerates malformed storage', () => {
		localStorage.setItem('key-lint.recent-projects', '{invalid json');
		const service = new RecentProjectsService(electronMock(false));
		expect(service.getRecentProjects()).toEqual([]);

		service.addRecentProject('/one');
		service.addRecentProject('/two');
		service.removeRecentProject('/ONE');
		expect(service.getRecentProjects().map((project) => project.path)).toEqual(['/two']);
	});
});
