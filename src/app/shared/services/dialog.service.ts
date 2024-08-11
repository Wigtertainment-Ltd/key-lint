import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { DialogResultType } from '../components/dialog/dialog.component';
import { LoggerService } from './logger.service';

const CLASSNAME: string = 'DialogService';

@Injectable({ providedIn: 'root' })
export class DialogService {
	constructor(private loggerService: LoggerService) { }

	onOpen: Subject<DialogOpenEvent> = new Subject();

	info(title: string, text: string): Promise<DialogResultType> {
		this.loggerService.debug(CLASSNAME + '.info');
		return this.open(title, text, 'info');
	}

	warning(title: string, text: string): Promise<DialogResultType> {
		this.loggerService.debug(CLASSNAME + '.warning');
		return this.open(title, text, 'warning');
	}

	danger(title: string, text: string): Promise<DialogResultType> {
		this.loggerService.debug(CLASSNAME + '.danger');
		return this.open(title, text, 'danger');
	}

	private open(title: string, text: string, type: 'info' | 'warning' | 'danger'): Promise<DialogResultType> {
		this.loggerService.debug(CLASSNAME + '.open');
		return new Promise((resolve: (value: DialogResultType | PromiseLike<DialogResultType>) => void, reject: (reason?: unknown) => void) => {
			this.loggerService.debug(CLASSNAME + '.open promise');
			this.onOpen.next({
				title: title,
				text: text,
				type: type,
				resolve: resolve,
				reject: reject
			} as DialogOpenEvent);
		});
	}
}

export class DialogOpenEvent {
	title!: string;
	text!: string;
	type!: 'info' | 'warning' | 'danger';
	resolve!: (value: DialogResultType | PromiseLike<DialogResultType>) => void;
	reject!: (reason?: unknown) => void;
}
