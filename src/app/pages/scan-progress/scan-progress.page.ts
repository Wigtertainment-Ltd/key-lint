import { Component, computed, effect, inject, Injector, OnDestroy, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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
export class ScanProgressPage implements OnInit, OnDestroy {
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
	private readonly injector: Injector = inject(Injector);
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

	readonly logLines = signal<string[]>([
		'Initializing analyzer engine...',
		'Loading project configuration...'
	]);

	private fakeLogTimer?: ReturnType<typeof setTimeout>;
	private lastProgressPercent = 0;
	private lastLoggedStage?: string;
	private hasLoggedCompletionMessage = false;
	private hasLoggedFailureMessage = false;
	private readonly loggedStepIds = new Set<number>();
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

		effect(() => {
			const snapshot = this.scanSnapshot();

			if (snapshot.stage && snapshot.stage !== this.lastLoggedStage) {
				this.lastLoggedStage = snapshot.stage;
				this.logStepFromStage(snapshot.stage);
				this.appendLog(snapshot.stage);
			}

			const nextProgress = this.calculateProgress(snapshot, this.lastProgressPercent);
			this.lastProgressPercent = nextProgress;
			this.progressPercent.set(nextProgress);

			if (snapshot.state === 'completed' && !this.hasLoggedCompletionMessage) {
				this.logRemainingStepsAsCompleted();
				this.hasLoggedCompletionMessage = true;
				this.appendLog(`Scan completed in ${snapshot.result?.durationMs ?? 0} ms.`);
			}

			if (snapshot.state === 'failed' && snapshot.error && !this.hasLoggedFailureMessage) {
				this.hasLoggedFailureMessage = true;
				this.appendLog(`ERROR: ${snapshot.error}`);
			}
		}, { injector: this.injector });

		this.startFillerLogs();
		void this.runScan();
	}

	ngOnDestroy(): void {
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

	private startFillerLogs(): void {
		let index = 0;
		const tick = (): void => {
			if (this.scanState() !== 'running') {
				return;
			}

			this.appendLog(this.fillerLogs[index % this.fillerLogs.length]);
			index += 1;
			const delayMs = 700 + (index % 5) * 140;
			this.fakeLogTimer = setTimeout(tick, delayMs);
		};

		this.fakeLogTimer = setTimeout(tick, 250);
	}

	private logStepFromStage(stage: string): void {
		const step = this.steps.find((item) => stage.includes(item.trigger));
		if (!step || this.loggedStepIds.has(step.id)) {
			return;
		}

		this.loggedStepIds.add(step.id);
		this.appendLog(`Step ${step.id}/${this.steps.length}: ${step.title}`);
	}

	private logRemainingStepsAsCompleted(): void {
		for (const step of this.steps) {
			if (this.loggedStepIds.has(step.id)) {
				continue;
			}

			this.loggedStepIds.add(step.id);
			this.appendLog(`Step ${step.id}/${this.steps.length}: ${step.title} (completed)`);
		}
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
