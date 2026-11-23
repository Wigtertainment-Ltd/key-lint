import { afterNextRender, Directive, ElementRef, inject, Injector, input, InputSignal, output, OutputEmitterRef } from '@angular/core';
import { AnalysisDetailFocus } from './analysis-detail-focus';

@Directive({
	selector: 'dialog[appTranslationDialog]',
	host: {
		'(cancel)': 'onCancel($event)',
		'(pointerdown)': 'onPointerDown($event)',
		'(click)': 'onClick($event)'
	}
})
export class TranslationDialogDirective {
	readonly origin: InputSignal<EventTarget | null | undefined> = input<EventTarget | null>();
	readonly dismissed: OutputEmitterRef<void> = output<void>();
	private readonly element: HTMLDialogElement = inject<ElementRef<HTMLDialogElement>>(ElementRef).nativeElement;
	private readonly injector: Injector = inject(Injector);
	private readonly detailFocus: AnalysisDetailFocus = inject(AnalysisDetailFocus);
	private startedOnBackdrop: boolean = false;

	constructor() {
		afterNextRender((): void => {
			if (this.element.isConnected && !this.element.open) {
				this.element.showModal();
				this.focusTextarea();
			}
		});
	}

	close(returnToOrigin: boolean): void {
		if (this.element.open) {
			this.element.close();
			this.detailFocus.restoreAfterDialog(returnToOrigin ? this.origin() : undefined);
		}
	}

	focusError(): void {
		afterNextRender((): void => this.element.querySelector<HTMLElement>('.modal-error')?.focus(), { injector: this.injector });
	}

	onCancel(event: Event): void {
		event.preventDefault();
		this.dismissed.emit();
	}

	onPointerDown(event: PointerEvent): void {
		this.startedOnBackdrop = event.button === 0 && this.isOnBackdrop(event);
	}

	onClick(event: MouseEvent): void {
		const startedOnBackdrop: boolean = this.startedOnBackdrop;
		this.startedOnBackdrop = false;
		if (startedOnBackdrop && this.isOnBackdrop(event)) {
			this.dismissed.emit();
		}
	}

	private isOnBackdrop(event: MouseEvent): boolean {
		if (event.target !== this.element) {
			return false;
		}
		const bounds: DOMRect = this.element.getBoundingClientRect();
		return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
	}

	private focusTextarea(): void {
		this.element.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)')?.focus();
	}
}
