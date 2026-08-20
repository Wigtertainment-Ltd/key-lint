import { DOCUMENT } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IFileSystemWarning } from '@key-lint/core';
import { Subscription } from 'rxjs';
import { ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';
import { AppVersionService } from '../../shared/services/app-version.service';
import { ThemeService } from '../../services/theme.service';

@Component({
	selector: 'app-analysis-layout-page',
	imports: [RouterOutlet, RouterLink, RouterLinkActive],
	templateUrl: './analysis-layout.page.html',
	styleUrl: './analysis-layout.page.scss'
})
export class AnalysisLayoutPage implements OnInit, OnDestroy {
	private readonly route: ActivatedRoute = inject(ActivatedRoute);
	private readonly router: Router = inject(Router);
	private readonly scanOrchestrationService: ScanOrchestrationService = inject(ScanOrchestrationService);
	private readonly document: Document = inject(DOCUMENT);
	projectPath = '';
	lastScanText = 'Running now';
	isSidebarCollapsed = false;
	private readonly fileSystemWarningsSignal = signal<IFileSystemWarning[]>([]);

	readonly themeService = inject(ThemeService);
	readonly appVersionService = inject(AppVersionService);

	get isDark(): boolean {
		return this.themeService.getCurrent() === 'dark';
	}

	private stateSubscription?: Subscription;

	ngOnInit(): void {
		this.document.documentElement.classList.add('analysis-scroll-lock');
		this.document.body.classList.add('analysis-scroll-lock');

		this.projectPath = this.route.snapshot.queryParamMap.get('projectPath') ?? '/root/apps/web-client';

		this.stateSubscription = this.scanOrchestrationService.state$.subscribe((snapshot) => {
			if (snapshot.result?.finishedAt) {
				this.lastScanText = snapshot.result.finishedAt;
			}

			this.fileSystemWarningsSignal.set(this.readFileSystemWarnings(
				snapshot.result?.metadata?.['fileSystemWarnings']
			));
		});
	}

	ngOnDestroy(): void {
		this.document.documentElement.classList.remove('analysis-scroll-lock');
		this.document.body.classList.remove('analysis-scroll-lock');
		this.stateSubscription?.unsubscribe();
	}

	get displayProjectPath(): string {
		return this.projectPath;
	}

	get displayProjectName(): string {
		let normalizedPath = this.projectPath.trim();

		while (normalizedPath.endsWith('/') || normalizedPath.endsWith('\\')) {
			normalizedPath = normalizedPath.slice(0, -1);
		}

		if (!normalizedPath) {
			return this.projectPath;
		}

		// Split on one or more Windows or Unix path separators and discard empty segments.
		const segments = normalizedPath.split(/[\\/]+/).filter(Boolean);
		return segments.at(-1) ?? this.projectPath;
	}

	get isEdgeToEdgeContent(): boolean {
		return (
			this.router.url.includes('/analysis/dashboard') ||
			this.router.url.includes('/analysis/results') ||
			this.router.url.includes('/analysis/translation-keys')
		);
	}

	get fileSystemWarnings(): IFileSystemWarning[] {
		return this.fileSystemWarningsSignal();
	}

	private readFileSystemWarnings(value: unknown): IFileSystemWarning[] {
		if (!Array.isArray(value)) {
			return [];
		}

		return value.filter((warning): warning is IFileSystemWarning =>
			warning !== null &&
			typeof warning === 'object' &&
			typeof (warning as IFileSystemWarning).code === 'string' &&
			typeof (warning as IFileSystemWarning).message === 'string'
		);
	}

	startNewAnalysis(): void {
		this.scanOrchestrationService.reset();
		void this.router.navigate(['/']);
	}

	toggleSidebar(): void {
		this.isSidebarCollapsed = !this.isSidebarCollapsed;
	}

	toggleTheme(): void {
		this.themeService.toggle();
	}
}
