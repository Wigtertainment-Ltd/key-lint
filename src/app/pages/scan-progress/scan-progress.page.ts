import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ScanExecutionSnapshot, ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';
import { IProjectScanResult } from '@key-lint/core';
import { LoggerService } from '../../shared/services/logging/logger.service';
import { IStepItem } from './scan-progress.interfaces';

@Component({
	selector: 'app-scan-progress-page',
	templateUrl: './scan-progress.page.html',
	styleUrl: './scan-progress.page.scss'
})
export class ScanProgressPage implements OnInit {
	projectPath = '';
	readonly scanState = computed<ScanExecutionSnapshot['state']>(() => this.scanSnapshot().state);
	readonly scanStage = computed(() => this.scanSnapshot().stage);
	readonly scanError = computed(() => this.scanSnapshot().error);
	readonly scanResult = computed<IProjectScanResult | undefined>(() => this.scanSnapshot().result);
	readonly progressPercent = signal(0);
	isCancelling = false;

	private readonly loggerService: LoggerService = inject(LoggerService);
	private readonly route: ActivatedRoute = inject(ActivatedRoute);
	private readonly router: Router = inject(Router);
	private readonly destroyRef: DestroyRef = inject(DestroyRef);
	private readonly scanOrchestrationService: ScanOrchestrationService = inject(ScanOrchestrationService);
	private readonly scanSnapshot = toSignal(this.scanOrchestrationService.state$, {
		initialValue: this.scanOrchestrationService.snapshot
	});
	readonly steps: IStepItem[] = [
		{ id: 1, title: 'Detecting framework', trigger: 'Detecting project adapter' },
		{ id: 2, title: 'Discovering translation files', trigger: 'Collecting translation files' },
		{ id: 3, title: 'Extracting keys', trigger: 'Extracting translation keys' },
		{ id: 4, title: 'Building translation table', trigger: 'Building translation matrix' },
		{ id: 5, title: 'Evaluating source code usage', trigger: 'Scanning source key usage' },
		{ id: 6, title: 'Running rule evaluation', trigger: 'Evaluating scan rules' }
	];

	readonly logLines = signal<string[]>([]);
	private lastProgressPercent = 0;
	private lastLoggedStage?: string;
	private hasLoggedCompletionMessage = false;
	private hasLoggedFailureMessage = false;
	private readonly loggedStepIds = new Set<number>();

	ngOnInit(): void {
		this.projectPath = this.route.snapshot.queryParamMap.get('projectPath') ?? '';
		if (!this.projectPath) {
			void this.router.navigate(['/']);
			return;
		}

		this.lastProgressPercent = 0;
		this.lastLoggedStage = undefined;
		this.hasLoggedCompletionMessage = false;
		this.hasLoggedFailureMessage = false;
		this.loggedStepIds.clear();

		this.scanOrchestrationService.state$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((snapshot) => {
			if (snapshot.stage && snapshot.stage !== this.lastLoggedStage) {
				this.lastLoggedStage = snapshot.stage;
				this.logStepFromStage(snapshot.stage);
				this.appendLog(snapshot.stage);
			}

			const nextProgress = this.calculateProgress(snapshot, this.lastProgressPercent);
			this.lastProgressPercent = nextProgress;
			this.progressPercent.set(nextProgress);

			if (snapshot.state === 'completed' && !this.hasLoggedCompletionMessage) {
				this.hasLoggedCompletionMessage = true;
				this.appendLog(`Scan completed in ${snapshot.result?.durationMs ?? 0} ms.`);
			}

			if (snapshot.state === 'failed' && snapshot.error && !this.hasLoggedFailureMessage) {
				this.hasLoggedFailureMessage = true;
				this.appendLog(`ERROR: ${snapshot.error}`);
			}
		});

		void this.runScan();
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
		return `${this.progressPercent()}%`;
	}

	get activeStepId(): number {
		if (this.scanState() === 'completed') {
			return this.steps.at(-1)?.id ?? 1;
		}

		const stage = this.scanStage();
		if (!stage) {
			return 1;
		}

		const idx = this.steps.findIndex((step) => stage.includes(step.trigger));
		return idx >= 0 ? this.steps[idx].id : 1;
	}

	isStepCompleted(step: IStepItem): boolean {
		if (this.scanState() === 'completed') {
			return true;
		}

		return step.id < this.activeStepId;
	}

	isStepActive(step: IStepItem): boolean {
		if (this.scanState() === 'completed') {
			return false;
		}

		if (this.scanState() === 'failed' && step.id === this.activeStepId) {
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
		if (this.scanState() !== 'completed') {
			return;
		}

		void this.router.navigate(['/analysis/dashboard'], {
			queryParams: {
				projectPath: this.projectPath
			}
		});
	}

	private async runScan(): Promise<void> {
		this.loggerService.info('ScanProgressPage', 'Starting scan for project path:', this.projectPath);
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
		this.logLines.update((lines) => [...lines, `[${timestamp}] ${message}`].slice(-80));
	}

	private logStepFromStage(stage: string): void {
		const step = this.steps.find((item) => stage.includes(item.trigger));
		if (!step || this.loggedStepIds.has(step.id)) {
			return;
		}

		this.loggedStepIds.add(step.id);
		this.appendLog(`Step ${step.id}/${this.steps.length}: ${step.title}`);
	}

	private calculateProgress(snapshot: ScanExecutionSnapshot, currentProgress: number): number {
		if (snapshot.state === 'completed') {
			return 100;
		}

		if (snapshot.state === 'failed') {
			return Math.max(10, currentProgress);
		}

		if (snapshot.state !== 'running') {
			return 0;
		}

		if (!snapshot.stage) {
			return 10;
		}

		const index = this.steps.findIndex((step) => snapshot.stage?.includes(step.trigger));
		if (index < 0) {
			return Math.max(15, currentProgress);
		}

		const ratio = (index + 1) / this.steps.length;
		return Math.min(95, Math.max(currentProgress, Math.round(ratio * 100)));
	}
}
