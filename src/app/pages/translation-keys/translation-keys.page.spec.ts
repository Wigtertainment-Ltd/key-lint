import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IProjectScanResult } from '@key-lint/core';
import { BehaviorSubject } from 'rxjs';

import { ScanExecutionSnapshot, ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';
import { ToastService } from '../../shared/services/toast.service';
import { TranslationKeysPage } from './translation-keys.page';

const result: IProjectScanResult = {
	projectRoot: 'C:/project',
	adapterId: 'angular',
	startedAt: '',
	finishedAt: '',
	durationMs: 1,
	summary: { totalKeys: 2, used: 0, unused: 2, dynamicOrUncertain: 0, indirectUncertain: 0, missingInLanguage: 0, extraInLanguage: 0, totalFindings: 2 },
	findings: [],
	errors: [],
	translationMatrix: {
		locales: ['de', 'en'],
		totalKeys: 2,
		rows: [
			{ key: 'APP.GREETING', values: { de: 'Hallo', en: 'Hello {{name}}' }, keyPresence: { de: true, en: true }, placeholders: { de: [], en: ['name'] } },
			{ key: 'APP.TITLE', values: { de: 'Titel', en: 'Title' }, keyPresence: { de: true, en: true }, placeholders: { de: [], en: [] } }
		]
	}
};

describe('TranslationKeysPage placeholders', () => {
	let fixture: ComponentFixture<TranslationKeysPage>;
	let component: TranslationKeysPage;
	let state: BehaviorSubject<ScanExecutionSnapshot>;

	beforeEach(async () => {
		state = new BehaviorSubject<ScanExecutionSnapshot>({ state: 'completed', result });
		await TestBed.configureTestingModule({
			imports: [TranslationKeysPage],
			providers: [
				provideRouter([]),
				{ provide: ScanOrchestrationService, useValue: { snapshot: state.value, state$: state.asObservable() } },
				{ provide: ToastService, useValue: { success: jasmine.createSpy('success') } }
			]
		}).compileComponents();
		fixture = TestBed.createComponent(TranslationKeysPage);
		component = fixture.componentInstance;
		fixture.detectChanges();
	});

	it('filters placeholder keys and exposes locale-specific names in details', () => {
		const row = result.translationMatrix!.rows[0];
		expect(component.hasPlaceholders(row)).toBeTrue();
		expect(component.placeholderFilterCount).toBe(1);
		component.onFilterChange('placeholders');
		expect(component.filteredRows.map((entry) => entry.key)).toEqual(['APP.GREETING']);
		component.onSelectRow(row);
		fixture.detectChanges();
		expect((fixture.nativeElement as HTMLElement).textContent).toContain('Placeholders by Locale');
		expect((fixture.nativeElement as HTMLElement).textContent).toContain('name');
	});

	it('disables missing-locale actions for remote read-only results', async () => {
		const row = {
			...result.translationMatrix!.rows[0],
			keyPresence: { de: true, en: false }
		};
		state.next({
			state: 'completed',
			result: {
				...result,
				metadata: { translationReadOnly: true },
				translationMatrix: {
					...result.translationMatrix!,
					rows: [row, ...result.translationMatrix!.rows.slice(1)]
				}
			}
		});
		fixture.detectChanges();
		await fixture.whenStable();
		component.onSelectRow(component.matrix.rows.find((entry) => entry.key === row.key)!);
		fixture.detectChanges();

		const addButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.add-missing-button');
		expect(component.isRemoteReadOnly).toBeTrue();
		expect(addButton?.disabled).toBeTrue();
		expect((fixture.nativeElement as HTMLElement).textContent).toContain('Remote translations are read-only.');
	});
});
