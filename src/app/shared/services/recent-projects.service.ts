import { Injectable } from '@angular/core';
import { ElectronService } from './electron.service';

export interface IRecentProjectItem {
	path: string;
	exists: boolean;
}

const RECENT_PROJECTS_STORAGE_KEY = 'key-lint.recent-projects';
const MAX_RECENT_PROJECTS = 5;

function normalizePath(path: string): string {
	// Collapse consecutive forward slashes after converting Windows separators.
	const normalized = path.trim().replaceAll('\\', '/').replace(/\/+/g, '/');
	// Match a Windows drive root with its trailing slash, for example "C:/".
	if (/^[A-Za-z]:\/$/.test(normalized) || normalized === '/') {
		return normalized;
	}

	// Remove one trailing slash from paths that are not filesystem roots.
	return normalized.replace(/\/$/, '');
}

function dedupeKey(path: string): string {
	return normalizePath(path).toLowerCase();
}

@Injectable({
	providedIn: 'root'
})
export class RecentProjectsService {
	constructor(private readonly electronService: ElectronService) {}

	async getRecentProjects(): Promise<IRecentProjectItem[]> {
		const recentPaths = this.readStoredPaths();
		return Promise.all(recentPaths.map(async (path) => ({
			path,
			exists: await this.pathExists(path)
		})));
	}

	addRecentProject(path: string): void {
		const normalizedPath = normalizePath(path);
		if (!normalizedPath) {
			return;
		}

		const existing = this.readStoredPaths();
		const withoutDuplicate = existing.filter((item) => dedupeKey(item) !== dedupeKey(normalizedPath));
		const updated = [normalizedPath, ...withoutDuplicate].slice(0, MAX_RECENT_PROJECTS);
		this.writeStoredPaths(updated);
	}

	removeRecentProject(path: string): void {
		const normalizedPath = normalizePath(path);
		if (!normalizedPath) {
			return;
		}

		const existing = this.readStoredPaths();
		const updated = existing.filter((item) => dedupeKey(item) !== dedupeKey(normalizedPath));
		this.writeStoredPaths(updated);
	}

	private readStoredPaths(): string[] {
		try {
			const raw = localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY);
			if (!raw) {
				return [];
			}

			const parsed = JSON.parse(raw) as unknown;
			if (!Array.isArray(parsed)) {
				return [];
			}

			return parsed
				.filter((value): value is string => typeof value === 'string')
				.map((value) => normalizePath(value))
				.filter(Boolean)
				.slice(0, MAX_RECENT_PROJECTS);
		} catch {
			return [];
		}
	}

	private writeStoredPaths(paths: string[]): void {
		try {
			localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(paths));
		} catch {
			// Ignore storage write failures to keep the selection flow uninterrupted.
		}
	}

	private async pathExists(path: string): Promise<boolean> {
		if (!this.electronService.isElectron) {
			return true;
		}

		try {
			return await this.electronService.pathExists(path);
		} catch {
			return false;
		}
	}
}
