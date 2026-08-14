import { ThemeService } from './theme.service';

describe('ThemeService', () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.removeAttribute('data-theme');
	});

	afterEach(() => {
		localStorage.clear();
		document.documentElement.removeAttribute('data-theme');
	});

	it('restores and applies a stored theme', () => {
		localStorage.setItem('app-theme', 'dark');
		const service = new ThemeService();

		service.initialize();

		expect(service.getCurrent()).toBe('dark');
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});

	it('toggles, applies, and persists the next theme', () => {
		localStorage.setItem('app-theme', 'light');
		const service = new ThemeService();

		service.toggle();

		expect(service.getCurrent()).toBe('dark');
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
		expect(localStorage.getItem('app-theme')).toBe('dark');
	});

	it('ignores invalid stored values', () => {
		localStorage.setItem('app-theme', 'blue');
		const service = new ThemeService();

		expect(['light', 'dark']).toContain(service.getCurrent());
	});
});
