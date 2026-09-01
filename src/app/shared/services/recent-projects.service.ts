import { Injectable } from '@angular/core';
import { normalizePath, pathDedupeKey } from '@key-lint/core';
import { ElectronService } from './electron.service';

export interface IRecentProjectItem {
	path: string;
	exists: boolean;
}

const RECENT_PROJECTS_STORAGE_KEY = 'key-lint.recent-projects';
const MAX_RECENT_PROJECTS = 5;

@Injectable({
	providedIn: 'root'
})
export class RecentProjectsService {
	constructor(private readonly electronService: ElectronService) {}

	async getRecentProjects(): Promise<IRecentProjectItem[]> {
		const recentPaths: string[] = this.readStoredPaths();
		return Promise.all(recentPaths.map(async (path) => ({
			path,
			exists: await this.pathExists(path)
		})));
	}

	addRecentProject(path: string): void {
		const normalizedPath: string = normalizePath(path);
		if (!normalizedPath) {
			return;
		}

		const existing: string[] = this.readStoredPaths();
		const withoutDuplicate: string[] = existing.filter((item) => pathDedupeKey(item) !== pathDedupeKey(normalizedPath));
		const updated: string[] = [normalizedPath, ...withoutDuplicate].slice(0, MAX_RECENT_PROJECTS);
		this.writeStoredPaths(updated);
	}

	removeRecentProject(path: string): void {
		const normalizedPath = normalizePath(path);
		if (!normalizedPath) {
			return;
		}

		const existing: string[] = this.readStoredPaths();
		const updated: string[] = existing.filter((item) => pathDedupeKey(item) !== pathDedupeKey(normalizedPath));
		this.writeStoredPaths(updated);
	}

	private readStoredPaths(): string[] {
		try {
			const raw: string = localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY);
			if (!raw) {
				return [];
			}

			const parsed: unknown = JSON.parse(raw) as unknown;
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
