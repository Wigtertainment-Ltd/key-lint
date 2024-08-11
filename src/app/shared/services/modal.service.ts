import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { WigFormGroup } from '../components/form/form.component';
import { LoggerService } from './logger.service';

const CLASSNAME: string = 'ModalService';

@Injectable({ providedIn: 'root' })
export class ModalService {
	constructor(private loggerService: LoggerService) {
	}

	onShow: Subject<ModalShowEvent> = new Subject();
	private resolve: (value: ModalResult<unknown> | PromiseLike<ModalResult<unknown>>) => void;
	private reject: (reason?: unknown) => void;

	show<T>(title: string, formGroup: WigFormGroup, options?: ModalShowOption): Promise<ModalResult<T>> {
		this.loggerService.debug(CLASSNAME + '.show');
		this.onShow.next({ title: title, formGroup: formGroup, options: options } as ModalShowEvent);
		return new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}

	submit<T>(value: T): void {
		this.resolve({ result: ModalResultType.Ok, formValues: value } as ModalResult<T>);
	}

	cancel<T>(): void {
		this.resolve({ result: ModalResultType.Cancel, formValues: null } as ModalResult<T>);
	}
}

export class ModalShowEvent {
	title: string;
	formGroup: WigFormGroup;
	options?: ModalShowOption;
}

export class ModalShowOption {
	draggble?: boolean;
	maximizable?: boolean;
	width?: string;
	closable?: boolean;
}

export class ModalResult<T> {
	result: ModalResultType;
	formValues?: T;
}

export enum ModalResultType { Ok = 'Ok', Cancel = 'Cancel' }
