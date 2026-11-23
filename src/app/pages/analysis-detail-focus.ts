import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { afterNextRender, effect, ElementRef, inject, Injectable, Injector, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

@Injectable()
export class AnalysisDetailFocus {
	private readonly host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
	private readonly injector: Injector = inject(Injector);
	readonly isOverlay: Signal<boolean> = toSignal(
		inject(BreakpointObserver).observe('(max-width: 1120px)').pipe(map((state: BreakpointState): boolean => state.matches)),
		{ initialValue: false }
	);
	private opener?: HTMLElement;
	private openerId?: string;

	constructor() {
		effect((): void => {
			if (this.isOverlay()) {
				afterNextRender((): void => {
					const pane: HTMLElement | null = this.host.querySelector<HTMLElement>('.details-pane[aria-modal="true"]');
					if (pane && !pane.contains(pane.ownerDocument.activeElement)) {
						pane.querySelector<HTMLElement>('.detail-key')?.focus();
					}
				}, { injector: this.injector });
			}
		});
	}

	open(origin?: EventTarget | null): void {
		if (!(origin instanceof HTMLElement)) {
			return;
		}

		this.opener = origin;
		this.openerId = origin.dataset['detailRowId'];
		afterNextRender((): void => {
			this.host.querySelector<HTMLElement>('.details-scroll')?.scrollTo({ top: 0 });
			this.host.querySelector<HTMLElement>('.detail-key')?.focus();
		}, { injector: this.injector });
	}

	restore(): void {
		const opener: HTMLElement | undefined = this.opener;
		const openerId: string | undefined = this.openerId;
		this.opener = undefined;
		this.openerId = undefined;

		afterNextRender((): void => {
			// CDK can reuse this element for a different row while the detail pane is open.
			if (opener?.isConnected && opener.dataset['detailRowId'] === openerId) {
				opener.focus();
				return;
			}

			this.host.querySelector<HTMLInputElement>('.search-box input')?.focus();
		}, { injector: this.injector });
	}

	restoreAfterDialog(origin?: EventTarget | null): void {
		afterNextRender((): void => {
			if (origin instanceof HTMLButtonElement && origin.isConnected && !origin.disabled) {
				origin.focus();
				return;
			}
			const fallback: HTMLElement | null = this.host.querySelector<HTMLElement>('.detail-key') ?? this.host.querySelector<HTMLInputElement>('.search-box input');
			fallback?.focus();
		}, { injector: this.injector });
	}
}
