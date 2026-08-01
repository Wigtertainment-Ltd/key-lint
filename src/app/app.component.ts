import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './services/theme.service';
import { ToastComponent } from './shared/components/toast/toast.component';

@Component({
	selector: 'app-root',
	imports: [RouterOutlet, ToastComponent],
	templateUrl: './app.component.html',
	styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
	private readonly themeService: ThemeService = inject(ThemeService);

	ngOnInit(): void {
		this.themeService.initialize();
	}
}
