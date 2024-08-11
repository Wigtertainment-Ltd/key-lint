import { Component, OnInit } from '@angular/core';
import { DialogModule } from 'primeng/dialog';
import { DialogOpenEvent, DialogService } from '../../services/dialog.service';
import { LoggerService } from '../../services/logger.service';
import { WigButtonComponent } from '../button/button.component';

const CLASSNAME: string = 'DialogComponent';

@Component({
	selector: 'wig-dialog',
	templateUrl: './dialog.component.html',
	imports: [DialogModule, WigButtonComponent],
	standalone: true,
})
export class WigDialogComponent implements OnInit {
	constructor(
		private dialogService: DialogService,
		private loggerService: LoggerService,
	) { }

	event!: DialogOpenEvent;
	isOpen: boolean = false;

	ngOnInit(): void {
		this.loggerService.debug(CLASSNAME + '.ngOnInit');
		this.dialogService.onOpen.subscribe((event: DialogOpenEvent) => {
			this.loggerService.debug(CLASSNAME + '.onOpen.subscribe');
			this.event = event;
			this.isOpen = true;
		});
	}

	ok(): void {
		this.isOpen = false;
		this.event.resolve(DialogResultType.Ok);
	}

	cancel(): void {
		this.isOpen = false;
		this.event.resolve(DialogResultType.Cancel);
	}
}

export class DialogResult {
	type!: DialogResultType;
}

export enum DialogResultType { Ok = 'Ok', Cancel = 'Cancel' }
