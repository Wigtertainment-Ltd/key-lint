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

	startNewAnalysis(): void {
		this.scanOrchestrationService.reset();
		void this.router.navigate(['/']);
	}
}
