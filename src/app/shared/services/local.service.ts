import { Injectable } from '@angular/core';

export enum LocalStorageKeys {
	RefreshToken = 'refreshToken',
	AccessToken = 'accessToken'
}

@Injectable({ providedIn: 'root' })
export class LocalStorageService {

	private keyPart: string = 'check-i18n';

	set<T>(key: LocalStorageKeys, value: T): void {
		localStorage.setItem(`${this.keyPart}.${key}`, JSON.stringify(value));
	}

	get<T>(key: LocalStorageKeys): T | null {
		let result: T | null = null;
		const item: string = localStorage.getItem(`${this.keyPart}.${key}`);
		result = item ? JSON.parse(item) : null;
		return result;
	}

	remove(key: LocalStorageKeys): void {
		localStorage.removeItem(`${this.keyPart}.${key}`);
	}

	removeAll(): void {
		localStorage.clear();
	}
}
