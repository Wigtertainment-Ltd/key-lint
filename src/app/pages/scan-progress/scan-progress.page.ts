import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ScanExecutionSnapshot, ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';
import { ProjectScanResult } from '@check-i18n/core';

interface StepItem {
	id: number;
	title: string;
	trigger: string;
}

@Component({
	selector: 'app-scan-progress-page',
	standalone: true,
	templateUrl: './scan-progress.page.html',
	styleUrl: './scan-progress.page.scss'
})
export class ScanProgressPage implements OnInit, OnDestroy {
	projectPath = '';
	scanState: ScanExecutionSnapshot['state'] = 'idle';
	scanStage?: string;
	scanError?: string;
	scanResult?: ProjectScanResult;
	progressPercent = 0;
	isCancelling = false;

	readonly steps: StepItem[] = [
		{ id: 1, title: 'Detecting framework', trigger: 'Detecting project adapter' },
		{ id: 2, title: 'Discovering translation files', trigger: 'Collecting translation files' },
		{ id: 3, title: 'Extracting keys', trigger: 'Extracting translation keys' },
		{ id: 4, title: 'Building translation table', trigger: 'Building translation matrix' },
		{ id: 5, title: 'Evaluating source code usage', trigger: 'Scanning source key usage' },
		{ id: 6, title: 'Running rule evaluation', trigger: 'Evaluating scan rules' }
	];

	logLines: string[] = [
		'Initializing analyzer engine...',
		'Loading local configuration: scanner defaults'
	];

	private stateSubscription?: Subscription;
	private fakeLogTimer?: ReturnType<typeof setTimeout>;
	private readonly fillerLogs: string[] = [
		'Scanning /src/app/core/interceptors/error.interceptor.ts...',
		'Checking /src/app/shared/pipes/translation.pipe.ts...',
		'Deep-scanning /src/app/features/reports/reports.module.ts...',
		'Found dynamic translation call in analytics service.',
		'Processing /src/assets/i18n/de.json...',
		'Verifying /src/assets/i18n/it.json...',
		'Scanning /src/app/components/charts/pie-chart.component.ts...',
		'Found potentially unused key: "ADMIN_DASHBOARD_V2_UNREAD_MESSAGES"',
		'Analyzing language selector component template...'
	];

	constructor(
		private readonly route: ActivatedRoute,
		private readonly router: Router,
		private readonly scanOrchestrationService: ScanOrchestrationService
	) {}

	ngOnInit(): void {
		this.projectPath = this.route.snapshot.queryParamMap.get('projectPath') ?? '';
		if (!this.projectPath) {
			void this.router.navigate(['/']);
			return;
		}

		this.stateSubscription = this.scanOrchestrationService.state$.subscribe((snapshot) => {
			this.scanState = snapshot.state;
			this.scanStage = snapshot.stage;
			this.scanError = snapshot.error;
			this.scanResult = snapshot.result;

			if (snapshot.stage) {
				this.appendLog(snapshot.stage);
			}

			this.progressPercent = this.calculateProgress(snapshot);

			if (snapshot.state === 'completed') {
				this.appendLog(`Scan completed in ${snapshot.result?.durationMs ?? 0} ms.`);
			}

			if (snapshot.state === 'failed' && snapshot.error) {
				this.appendLog(`ERROR: ${snapshot.error}`);
			}
		});

		this.startFillerLogs();
		void this.runScan();
	}

	ngOnDestroy(): void {
		this.stateSubscription?.unsubscribe();
		if (this.fakeLogTimer) {
			clearTimeout(this.fakeLogTimer);
		}
	}

	get selectedProjectShort(): string {
		const normalized = this.projectPath.replaceAll('\\', '/');
		const parts = normalized.split('/').filter(Boolean);
		if (parts.length <= 3) {
			return this.projectPath;
		}

		return `.../${parts.slice(-3).join('/')}`;
	}

	get scanPercentLabel(): string {
		return `${this.progressPercent}%`;
	}

	get activeStepId(): number {
		if (this.scanState === 'completed') {
			return this.steps.at(-1)?.id ?? 1;
		}

		if (!this.scanStage) {
			return 1;
		}

		const idx = this.steps.findIndex((step) => this.scanStage?.includes(step.trigger));
		return idx >= 0 ? this.steps[idx].id : 1;
	}

	isStepCompleted(step: StepItem): boolean {
		if (this.scanState === 'completed') {
			return true;
		}

		return step.id < this.activeStepId;
	}

	isStepActive(step: StepItem): boolean {
		if (this.scanState === 'completed') {
			return false;
		}

		if (this.scanState === 'failed' && step.id === this.activeStepId) {
			return false;
		}

		return step.id === this.activeStepId;
	}

	cancelAnalysis(): void {
		this.isCancelling = true;
		this.scanOrchestrationService.reset();
		void this.router.navigate(['/'], {
			queryParams: {
				projectPath: this.projectPath
			}
		});
	}

	showResults(): void {
		if (this.scanState !== 'completed') {
			return;
		}

		void this.router.navigate(['/analysis/dashboard'], {
			queryParams: {
				projectPath: this.projectPath
			}
		});
	}

	private async runScan(): Promise<void> {
		try {
			await this.scanOrchestrationService.scanProject(this.projectPath);
		} catch {
			// State is already handled by the service snapshot.
		}
	}

	private appendLog(message: string): void {
		if (!message) {
			return;
		}

		const timestamp = new Date().toLocaleTimeString();
		this.logLines = [...this.logLines, `[${timestamp}] ${message}`].slice(-80);
	}

	private startFillerLogs(): void {
		let index = 0;
		const tick = () => {
			if (this.scanState !== 'running') {
				return;
			}

			this.appendLog(this.fillerLogs[index % this.fillerLogs.length]);
			index += 1;
			const delayMs = 700 + (index % 5) * 140;
			this.fakeLogTimer = setTimeout(tick, delayMs);
		};

		this.fakeLogTimer = setTimeout(tick, 900);
	}

	private calculateProgress(snapshot: ScanExecutionSnapshot): number {
		if (snapshot.state === 'completed') {
			return 100;
		}

		if (snapshot.state === 'failed') {
			return Math.max(10, this.progressPercent);
		}

		if (snapshot.state !== 'running') {
			return 0;
		}

		if (!snapshot.stage) {
			return 10;
		}

		const index = this.steps.findIndex((step) => snapshot.stage?.includes(step.trigger));
		if (index < 0) {
			return Math.max(15, this.progressPercent);
		}

		const ratio = (index + 1) / this.steps.length;
		return Math.min(95, Math.max(this.progressPercent, Math.round(ratio * 100)));
	}
}
