import { EventEmitter, Injectable, Output } from '@angular/core';

@Injectable({ providedIn: 'platform' })
export class StateService {
	private state: Record<string, unknown> = {};
	@Output() changed: EventEmitter<IStateChangedEvent> = new EventEmitter<IStateChangedEvent>();

	set(key: StateKey, value: unknown): void {
		if (this.state[key] !== value) {
			this.state[key] = value;
			this.changed.emit({key: key, value: value} as IStateChangedEvent);
		}
	}

	get<T>(key: StateKey): T {
		return this.state[key] as T;
	}

	remove(key: StateKey): void {
		delete this.state[key];
	}
}

export enum StateKey {
	MobileView = 'mobileView',
	User = 'user',
}

export interface IStateChangedEvent {
	key: StateKey;
	value: unknown;
}