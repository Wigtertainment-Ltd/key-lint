import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [AppComponent],
		}).compileComponents();
	});

	it('should create the app', () => {
		const fixture = TestBed.createComponent(AppComponent);
		const app = fixture.componentInstance;
		expect(app).toBeTruthy();
	});

	it('should initialize modal state', () => {
		const fixture = TestBed.createComponent(AppComponent);
		const app = fixture.componentInstance;
		expect(app.modalVisible).toBeTrue();
		expect(app.projectPath).toBeUndefined();
	});

	it('should keep projectName undefined when no project is selected', () => {
		const fixture = TestBed.createComponent(AppComponent);
		const app = fixture.componentInstance;
		expect(app.projectName).toBeUndefined();
	});

	it('should not throw when checkProject is called without a selected project', async () => {
		const fixture = TestBed.createComponent(AppComponent);
		const app = fixture.componentInstance;

		await expectAsync(app.checkProject()).toBeResolved();
	});
});
