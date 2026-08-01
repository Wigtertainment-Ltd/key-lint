import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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
	projectPath = '';
	lastScanText = 'Running now';
	isSidebarCollapsed = false;

	readonly themeService = inject(ThemeService);
	readonly appVersionService = inject(AppVersionService);

	get isDark(): boolean {
		return this.themeService.getCurrent() === 'dark';
	}

	private stateSubscription?: Subscription;

	ngOnInit(): void {
		this.projectPath = this.route.snapshot.queryParamMap.get('projectPath') ?? '/root/apps/web-client';

		this.stateSubscription = this.scanOrchestrationService.state$.subscribe((snapshot) => {
			if (snapshot.result?.finishedAt) {
				this.lastScanText = snapshot.result.finishedAt;
			}
		});
	}

	ngOnDestroy(): void {
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
