import { ThemeService } from './theme.service';

describe('ThemeService', (): void => {
	beforeEach((): void => {
		localStorage.clear();
		document.documentElement.removeAttribute('data-theme');
	});

	afterEach((): void => {
		localStorage.clear();
		document.documentElement.removeAttribute('data-theme');
	});

	it('restores and applies a stored theme', (): void => {
		localStorage.setItem('app-theme', 'dark');
		const service: ThemeService = new ThemeService();

		service.initialize();

		expect(service.getCurrent()).toBe('dark');
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});

	it('toggles, applies, and persists the next theme', (): void => {
		localStorage.setItem('app-theme', 'light');
		const service: ThemeService = new ThemeService();

		service.toggle();

		expect(service.getCurrent()).toBe('dark');
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
		expect(localStorage.getItem('app-theme')).toBe('dark');
	});

	it('ignores invalid stored values', (): void => {
		localStorage.setItem('app-theme', 'blue');
		const service: ThemeService = new ThemeService();

		expect(['light', 'dark']).toContain(service.getCurrent());
	});
});
