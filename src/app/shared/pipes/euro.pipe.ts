import { formatCurrency, getCurrencySymbol } from '@angular/common';
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'euro', standalone: true })
export class EuroPipe implements PipeTransform {
	transform(
		value: number,
		currencyCode: string = 'EUR',
		// display: 'code' | 'symbol' | 'symbol-narrow' | string | boolean = 'symbol',
		digitsInfo: string = '3.2-2',
		locale: string = 'de-DE',
	): string | null {
		return formatCurrency(
			value,
			locale,
			getCurrencySymbol(currencyCode, 'wide'),
			currencyCode,
			value ? digitsInfo : '1.0-0',
		);
	}

}
