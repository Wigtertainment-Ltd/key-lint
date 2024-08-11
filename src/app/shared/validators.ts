import { ValidationErrors } from "@angular/forms";
import { WigFormControl } from "./components";

export class WigValidators {
	static readonly containsUpperCaseLetterValidator = (control: WigFormControl): ValidationErrors => {
		if (control?.value && !/[A-Z]/.test(control.value)) {
			control.setErrors({ uppercaseLettersRequired: true });
		} else {
			control.setErrors(null);
		}
		return control?.errors;
	}

	static readonly containsLowerCaseLetterValidator = (control: WigFormControl): ValidationErrors => {
		if (control?.value && !/[a-z]/.test(control.value)) {
			control.setErrors({ lowercaseLettersRequired: true });
		} else {
			control.setErrors(null);
		}
		return control?.errors;
	}

	static readonly containsNumberValidator = (control: WigFormControl): ValidationErrors => {
		if (control?.value && !/\d/g.test(control.value)) {
			control.setErrors({ numbersRequired: true });
		} else {
			control.setErrors(null);
		}
		return control?.errors;
	}

	static readonly confirmPasswordValidator = (control: WigFormControl): ValidationErrors => {
		const password: string = control.parent?.get('password')?.value;
		const confirmPassword: string = control.value;
		if (password && confirmPassword) {
			if (password !== confirmPassword) {
				control.setErrors({ mismatch: true });
			} else {
				control.setErrors(null);
			}
		}
		return control?.errors;
	};
}
