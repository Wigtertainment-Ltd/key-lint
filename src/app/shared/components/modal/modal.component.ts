import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { Dialog, DialogModule } from 'primeng/dialog';
import { Subscription } from 'rxjs';
import { ModalService, ModalShowEvent, ModalShowOption } from '../../services/modal.service';
import { StateKey, StateService } from '../../services/state.service';
import { WigButtonComponent } from '../button/button.component';
import { WigFormComponent, WigFormGroup } from '../form/form.component';

@Component({
	selector: 'wig-modal',
	templateUrl: './modal.component.html',
	imports: [CommonModule, WigFormComponent, WigButtonComponent, DialogModule],
	standalone: true
})
export class WigModalComponent implements OnInit, OnDestroy {
	constructor(
		private modalService: ModalService,
		private stateService: StateService
	) { }

	@ViewChild('helloForm') helloForm: WigFormComponent;
	@ViewChild('dialog') dialog: Dialog;
	@Input() title: string = '';
	@Input() formGroup: WigFormGroup = null;
	@Input() options: ModalShowOption = null;
	@Output() onSubmit: EventEmitter<void> = new EventEmitter();
	@Output() onCancel: EventEmitter<void> = new EventEmitter();
	@Input() visible: boolean = false;
	@Input() hideFooter: boolean = false;
	showLoader: boolean = false;
	subscriptions: Subscription[] = [];
	private isModalView: boolean = false;

	ngOnInit(): void {
		this.subscriptions.push(
			this.modalService.onShow.subscribe((event: ModalShowEvent) => {
				this.visible = true;
				this.title = event.title;
				this.formGroup = event.formGroup;
				this.options = event.options;
			}),
			this.stateService.changed.subscribe((key: StateKey) => {
				if (key === StateKey.MobileView) {
					this.isModalView = this.stateService.get(key);
				}
			})
		);
		this.isModalView = this.stateService.get(StateKey.MobileView);
	}

	ngOnDestroy(): void {
		this.subscriptions.forEach(s => s.unsubscribe());
	}

	ok(): void {
		this.onSubmit.emit();
		this.visible = false;
	}

	submit(formValues: Record<string, unknown> = null): void {
		this.modalService.submit(formValues);
		this.visible = false;
	}

	cancel(): void {
		if (this.formGroup) {
			this.modalService.cancel();
		}
		this.onCancel.emit();
		this.visible = false;
	}

	showDialog(): void {
		if (this.isModalView) {
			this.dialog.maximize();
		}
	}
}
