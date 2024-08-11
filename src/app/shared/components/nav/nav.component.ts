import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MenuItem } from 'primeng/api';
import { AvatarModule } from 'primeng/avatar';
import { MenubarModule } from 'primeng/menubar';
import { TagModule } from 'primeng/tag';
import { TranslationService } from '../../services';

@Component({
	standalone: true,
	imports: [CommonModule, MenubarModule, AvatarModule, TagModule, RouterModule],
	selector: 'wig-nav',
	templateUrl: './nav.component.html'
})
export class NavComponent implements OnInit {
	constructor(
		private translationService: TranslationService
	) { }

	items: MenuItem[] | undefined;

	ngOnInit() {
		this.initNaVItems();
	}

	private initNaVItems(): void {
		this.items = [
			{
				label: this.translationService.instant('NAV.HOME'),
				icon: 'pi pi-home',
				routerLink: '/home/welcome'
			}
		]
	}
}
