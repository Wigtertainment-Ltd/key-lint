import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class TranslationService extends TranslateService {
	translate(key: string, interpolateParams?: unknown): Promise<string> {
		return firstValueFrom(this.get(key, interpolateParams));
	}
}
