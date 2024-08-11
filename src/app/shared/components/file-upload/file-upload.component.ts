import { Component, Input, ViewChild, forwardRef } from "@angular/core";
import { AbstractControl, ControlValueAccessor, FormsModule, NG_VALIDATORS, NG_VALUE_ACCESSOR, ReactiveFormsModule, ValidationErrors, Validator } from "@angular/forms";
import { FileUpload, FileUploadModule } from 'primeng/fileupload';
import { WigButtonComponent } from "../button/button.component";
import { WigFormControl } from "../form/form.component";

@Component({
	selector: 'wig-file-upload',
	templateUrl: './file-upload.component.html',
	imports: [
		FormsModule,
		FileUploadModule,
		ReactiveFormsModule,
		WigButtonComponent
	],
	standalone: true,
	styleUrls: ['./file-upload.component.scss'],
	providers: [
		{
			provide: NG_VALUE_ACCESSOR,
			useExisting: forwardRef(() => WigFileUploadComponent),
			multi: true
		},
		{
			provide: NG_VALIDATORS,
			useExisting: forwardRef(() => WigFileUploadComponent),
			multi: true
		}
	]
})
export class WigFileUploadComponent implements ControlValueAccessor, Validator {
	@Input() multiple: boolean = false;
	@Input() required: boolean = false;
	@Input() accept: string = 'image/*';
	@Input() maxFileSize: number;
	@Input() name: string;
	@ViewChild('fileUpload') fileUpload: FileUpload;
	@Input() formControl: WigFormControl;
	files: File[] = [];
	disabled: boolean = false;

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	onChange: (files: File[]) => unknown = () => { };
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	onTouched: () => unknown = () => { };

	writeValue(files: File[]): void {
		this.files = files?.filter(file => this.fileUpload.isFileSelected(file)) ?? [];
		this.onChange(this.files);
		this.formControl?.setValue(this.files, { onlySelf: true, emitEvent: false, emitModelToViewChange: false, emitViewToModelChange: false });

	}

	registerOnChange(fn: () => void): void {
		this.onChange = fn;
	}

	registerOnTouched(fn: () => void): void {
		this.onTouched = fn;
	}

	setDisabledState?(isDisabled: boolean): void {
		this.disabled = isDisabled;
	}

	validate(control: AbstractControl<unknown, unknown>, files?: File[]): ValidationErrors {
		let result = null;
		if (files) {
			for (const file of files) {
				if (this.maxFileSize && file.size > this.maxFileSize) {
					result = { maxFileSize: true, actual: file.size };
				}
				if (!this.isFileTypeAccepted(file)) {
					result = {
						invalidAccept: {
							accept: this.accept,
						},
					};
				}
			}
			if (files.length === 0 && this.required) {
				result = {
					required: true
				};
			}
		}
		return result;
	}

	private isFileTypeAccepted(file: File) {
		const accepts: string[] = this.accept.split(',');
		let result = false;
		for (const acc of accepts) {
			if (file.type && acc.includes('/')) {
				if (file.type === acc) {
					result = true;
					break;
				}
				if (acc.includes('*') && acc.startsWith(file.type.replace(/\/.*/, ''))) {
					result = true;
					break;
				}
			}

			if (file.name && this.getFileExtension(acc) === this.getFileExtension(file.name)) {
				result = true;
				break;
			}
		}
		return result;
	}

	private getFileExtension(filename: string): string {
		return filename.split('.').pop();
	}

	onRemoveFile(event: Event, file: File) {
		this.fileUpload.remove(event, this.fileUpload.files.indexOf(file));
		this.files = this.files.filter(f => f !== file) ?? [];
		this.onChange(this.files);
		this.formControl?.setValue(this.files);
	}
}
