import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { AbstractControl, FormControlOptions, FormsModule, ReactiveFormsModule, UntypedFormControl, UntypedFormGroup, ValidatorFn, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { CheckboxModule } from 'primeng/checkbox';
import { DividerModule } from 'primeng/divider';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { SelectButtonModule } from 'primeng/selectbutton';
import { Observable, Subscription } from 'rxjs';
import { LoggerService } from '../../services/logger.service';
import { WigValidators } from '../../validators';
import { WigButtonComponent } from '../button/button.component';
import { WigFileUploadComponent } from '../file-upload/file-upload.component';

const CLASSNAME: string = 'FormComponent';

@Component({
	selector: 'wig-form',
	templateUrl: './form.component.html',
	imports: [
		CommonModule,
		FormsModule,
		ReactiveFormsModule,
		InputTextModule,
		InputNumberModule,
		PasswordModule,
		PasswordModule,
		DropdownModule,
		// EditorModule,
		SelectButtonModule,
		CheckboxModule,
		WigButtonComponent,
		DividerModule,
		TranslateModule,
		WigFileUploadComponent
	],
	standalone: true
})
export class WigFormComponent {
	constructor(
		private loggerService: LoggerService
	) { }

	controls: ControlType[] = [];
	layoutGroups: { title: string | null, icon: string | null, cssClass: string | null, controls: ControlType[] }[] = [];
	formGroup: WigFormGroup;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	@Output() onSubmit: EventEmitter<any> = new EventEmitter();
	@Input('formGroup') set _formGroup(group: WigFormGroup | WigStyledFormGroup) {
		if (group) {
			this.formGroup = group instanceof WigFormGroup ? group : group instanceof WigStyledFormGroup ? group.formGroup : null;
			if (this.formGroup) {
				this.controls = [];
				for (const control in this.formGroup.controls) {
					this.controls.push({ key: control, control: this.formGroup.controls[control] as WigFormControl });
				}
				this.initLayoutGroups(group);
				this.initPasswordControls();
			}
		}
	}
	@ViewChild('button') submitButton!: ElementRef<HTMLButtonElement>;
	Validators: typeof Validators = Validators;

	private initLayoutGroups(group: WigFormGroup | WigStyledFormGroup): void {
		if (group instanceof WigFormGroup) {
			const controls: ControlType[] = [];
			for (const control in group.controls) {
				controls.push({ key: control, control: this.formGroup?.controls[control] as WigFormControl });
			}
			this.layoutGroups = [{ title: null, icon: null, cssClass: 'col', controls: controls }];
		}
		if (group instanceof WigStyledFormGroup) {
			this.layoutGroups = [];
			for (const g of group.groups) {
				const controls: ControlType[] = [];
				for (const control in g.controls) {
					controls.push({ key: control, control: this.formGroup?.controls[control] as WigFormControl });
				}
				this.layoutGroups.push({ title: g.title, icon: g.icon, cssClass: g.cssClass, controls: controls });
			}
		}
	}

	private initPasswordControls() {
		this.controls.filter(c => c.control.config.type === 'password').forEach(c => this.addPasswordValidators(c.control));
	}

	private addPasswordValidators(control: WigFormControl): void {
		if (control.config.passwordOptions?.minLength) {
			control.addValidators([Validators.minLength(control.config.passwordOptions.minLength)]);
		}
		if (control.config.passwordOptions?.mustContainUppercase) {
			control.addValidators([WigValidators.containsUpperCaseLetterValidator]);
		}
		if (control.config.passwordOptions?.mustContainLowercase) {
			control.addValidators([WigValidators.containsLowerCaseLetterValidator]);
		}
		if (control.config.passwordOptions?.mustContainNumber) {
			control.addValidators([WigValidators.containsNumberValidator]);
		}
	}

	hasValidator(key: string, control: WigFormControl, validator: ValidatorFn): boolean {
		return this.formGroup?.controls[key]?.hasValidator(validator) ?? false;
	}

	submit(): void {
		this.submitButton.nativeElement.click();
	}

	protected submitForm(): void {
		this.loggerService.debug(CLASSNAME + '.submit');
		this.formGroup.submitted = true;

		const statusChangedSubscription: Subscription = this.formGroup.statusChanges.subscribe(state => {
			this.loggerService.debug(CLASSNAME + '.formGroup.statusChanges', state);
			if (state === 'VALID') {
				const values: Record<string, unknown> = this.getValues(this.formGroup.controls);
				this.onSubmit.emit(values);
			}

			if (state === 'VALID' || state === 'INVALID') {
				statusChangedSubscription.unsubscribe();
			}
		});

		this.formGroup.markAsDirty();
		this.formGroup.markAsPristine();
		this.formGroup.markAllAsTouched();
		this.formGroup.updateValueAndValidity({ onlySelf: false, emitEvent: true });
	}

	getValues(controls: Record<string, AbstractControl>): Record<string, unknown> {
		const keys: string[] = Object.keys(controls);
		const values: Record<string, unknown> = keys.reduce((obj, f) => ({
			...obj,
			[f]: this.formGroup.controls[f].value
		}), {});
		return values;
	}

	getErrors(control: AbstractControl): IWigFormControlError[] {
		const errors: IWigFormControlError[] = [];
		for (const error in control.errors || []) {
			if (control.errors[error]) {
				errors.push({ name: error, props: control.errors[error] });
			}
		}
		return errors;
	}

	isControlVisible(control: WigFormControl): boolean {
		let result: boolean = true;
		if (control.config?.isVisible !== undefined && control.config?.isVisible !== null) {
			if (typeof control.config.isVisible === 'boolean') { result = control.config.isVisible; }
			if (typeof control.config.isVisible === 'function') { result = control.config.isVisible(control); }
		}
		return result;
	}
}

export class WigFormGroup extends UntypedFormGroup {
	declare controls: { [key: string]: WigFormControl; };
	submitted?: boolean = false;
}

// TODO: Erstmal nur eine Idee, muss später ausgebaut werden
export class WigStyledFormGroup {
	constructor(groups: WigStyledGroup[]) {
		this.groups = groups;
	}
	formGroup!: WigFormGroup;
	private _groups: WigStyledGroup[] = [];
	get groups(): WigStyledGroup[] {
		return this._groups;
	}
	set groups(value: WigStyledGroup[]) {
		this._groups = value;
		this.setFormGroup();
	}

	setFormGroup(): void {
		let result: { [key: string]: WigFormControl; } = {};
		this.groups.forEach(g => result = { ...result, ...g.controls });
		this.formGroup = new WigFormGroup(result);
	}
}

export class WigStyledGroup {
	constructor(public title: string, public icon: string, public cssClass: string, public controls: { [key: string]: WigFormControl }) { }
}

export class WigFormControl extends UntypedFormControl {
	constructor(formState: unknown, config: IWigFormControlOptions, updateOn: 'change' | 'blur' | 'submit' = 'blur') {
		config.updateOn = updateOn;
		super(formState, config);
		this.config = config;
	}
	config: IWigFormControlOptions;
}

export interface IWigFormControlOptions extends FormControlOptions {
	groupIcon?: string;
	groupLabel?: string;
	label?: string;
	info?: string;
	asyncLabel?: Observable<string>;
	type: 'input' | 'input-group' | 'number' | 'checkbox' | 'password' | 'email' | 'select' | 'selectButton' | 'textarea' | 'wysiwyg' | 'file-upload',
	placeholder?: string;
	selectOptions?: IWigFormControlSelectOption;
	selectButtonOptions?: IWigFormControlSelectButtomOption;
	numberOptions?: IWigFormControlNumberOption;
	inputGroupOptions?: IWigFormControlInputGroupOption;
	fileUploadOptions?: IWigFormFileUploadOption;
	passwordOptions?: IWigFormControlPasswordOption;
	isVisible?: boolean | ((control: WigFormControl) => boolean);
	readonly visible?: boolean;
}

export interface IWigFormControlSelectOption {
	labelProperty: string;
	valueProperty: string;
	options: unknown[];
	localFilter?: boolean;
	disabled?: boolean;
}

export interface IWigFormControlNumberOption {
	/**
	 * "EUR"
	 */
	currency?: string;
	/**
	 * "de-DE"
	 */
	locale?: string;
	suffix?: string;
	prefix?: string;
	min?: number;
	max?: number;
	minFractionDigits?: number;
	maxFractionDigits?: number;
}

export interface IWigFormControlSelectButtomOption {
	options: unknown[];
	optionLabel: string;
	optionValue: string;
}


export interface IWigFormControlError {
	name: string;
	props: unknown;
}

export interface IWigFormControlInputGroupOption {
	startIcons?: unknown;
	startButton?: IWigFormControlInputGroupButtonOption;
	endButton?: IWigFormControlInputGroupButtonOption;
	endIcons?: unknown;
}

export interface IWigFormControlInputGroupButtonOption {
	label?: string;
	icon?: string;
	styleClass?: string;
	click: () => void
}

export interface IWigFormFileUploadOption {
	multiple?: boolean;
	maxSize?: number;
	accept?: string;
}

export interface IWigFormControlPasswordOption {
	minLength?: number;
	mustContainUppercase?: boolean;
	mustContainLowercase?: boolean;
	mustContainNumber?: boolean;
	showFeedback?: boolean;
}

interface ControlType {
	key: string, control: WigFormControl
}
