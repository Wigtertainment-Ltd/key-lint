import { Injectable } from '@angular/core';

export type Theme = 'light' | 'dark';

@Injectable({
	providedIn: 'root'
})
export class ThemeService {
	private readonly STORAGE_KEY = 'app-theme';
	private currentTheme: Theme = this.resolveInitialTheme();

	initialize(): void {
		this.apply(this.currentTheme);
	}

	toggle(): void {
		const next = this.currentTheme === 'light' ? 'dark' : 'light';
		this.currentTheme = next;
		this.apply(next);
		try {
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem(this.STORAGE_KEY, next);
			}
		} catch {
			// storage full or unavailable — no-op
		}
	}

	getCurrent(): Theme {
		return this.currentTheme;
	}

	private apply(theme: Theme): void {
		if (typeof document !== 'undefined') {
			document.documentElement.setAttribute('data-theme', theme);
		}
	}

	private resolveInitialTheme(): Theme {
		const stored = this.readStoredTheme();
		if (stored) {
			return stored;
		}

		if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
			return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}

		return 'light';
	}

	private readStoredTheme(): Theme | undefined {
		try {
			if (typeof localStorage === 'undefined') {
				return undefined;
			}

			const stored = localStorage.getItem(this.STORAGE_KEY);
			if (stored === 'light' || stored === 'dark') {
				return stored;
			}
		} catch {
			// storage unavailable — fall back to system preference
		}

		return undefined;
	}
}
