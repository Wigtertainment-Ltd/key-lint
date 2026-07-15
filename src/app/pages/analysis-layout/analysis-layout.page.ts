import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';

@Component({
	selector: 'app-analysis-layout-page',
	standalone: true,
	imports: [RouterOutlet, RouterLink, RouterLinkActive],
	templateUrl: './analysis-layout.page.html',
	styleUrl: './analysis-layout.page.scss'
})
export class AnalysisLayoutPage implements OnInit, OnDestroy {
	projectPath = '';
	lastScanText = 'Running now';
	isSidebarCollapsed = false;
	private stateSubscription?: Subscription;

	constructor(
		private readonly route: ActivatedRoute,
		private readonly router: Router,
		private readonly scanOrchestrationService: ScanOrchestrationService
	) {}

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
		return this.router.url.includes('/scan-progress/results');
	}

	startNewAnalysis(): void {
		this.scanOrchestrationService.reset();
		void this.router.navigate(['/']);
	}

	toggleSidebar(): void {
		this.isSidebarCollapsed = !this.isSidebarCollapsed;
	}
}
