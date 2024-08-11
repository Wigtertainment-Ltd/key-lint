import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { DialogModule } from 'primeng/dialog';
import { SidebarModule } from 'primeng/sidebar';
import { Subscription } from 'rxjs';
import { StateKey, StateService } from '../../services/state.service';
import { DrawerSize } from './drawer.enums';

@Component({
	selector: 'wig-drawer',
	templateUrl: './drawer.component.html',
	styleUrls: ['./drawer.component.scss'],
	imports: [CommonModule, DialogModule, SidebarModule],
	standalone: true,
})
export class WigDrawerComponent implements OnInit, OnDestroy {
	constructor(
		private stateService: StateService
	) { }

	subscriptions: Subscription[] = [];
	isMobileView: boolean = false;
	@Input() size: DrawerSize = DrawerSize.sm;
	@Input() icon: string = '';
	@Input() header: string = '';
	@Input() position: 'right' | 'left' | 'top' | 'bottom' = 'right';
	@Input() visible: boolean = false;
	@Output() visibleChange: EventEmitter<boolean> = new EventEmitter();

	ngOnInit(): void {
		this.subscriptions.push(
			this.stateService.changed.subscribe((key: StateKey) => {
				if (key === StateKey.MobileView) {
					this.isMobileView = this.stateService.get(StateKey.MobileView);
				}
			})
		);
		this.isMobileView = this.stateService.get(StateKey.MobileView);
	}

	ngOnDestroy(): void {
		this.subscriptions.forEach(sub => sub.unsubscribe());
	}

	visibleChanged(value: boolean): void {
		this.visibleChange.emit(value);
	}
}
