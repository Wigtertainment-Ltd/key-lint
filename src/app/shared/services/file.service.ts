import { Injectable } from "@angular/core";

@Injectable({ providedIn: 'root' })
export class FileService {
	fileToBase64(file: File | Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			if (file) {
				const reader = new FileReader();
				reader.readAsDataURL(file);
				reader.onload = () => resolve((reader.result as string).split(',')[1] as string);
				reader.onerror = (error) => reject(error);
			}
			else {
				resolve(undefined);
			}
		});
	}

	getResizedImageAsBase64(file: File, maxWidth: number, maxHeight: number): Promise<string> {
		return new Promise((resolve, reject) => {
			this.resizeFileImage(file, maxWidth, maxHeight)
				.then(async (blob) => {
					resolve(await this.fileToBase64(blob));
				})
				.catch((error) => reject(error));
		});
	}

	resizeFileImage(file: File, maxWidth: number, maxHeight: number): Promise<Blob> {
		return new Promise((resolve, reject) => {
			const image = new Image();
			image.src = URL.createObjectURL(file);
			image.onload = () => {
				if (image.width <= maxWidth && image.height <= maxHeight) {
					resolve(file);
				}
				else {
					const newWidth: number = this.calculateFileImageWidth(image, maxWidth, maxHeight);
					const newHeight: number = this.calculateFileImageHeight(image, maxWidth, maxHeight);
					const canvas = document.createElement('canvas');
					canvas.width = newWidth;
					canvas.height = newHeight;
					const context = canvas.getContext('2d');
					context.drawImage(image, 0, 0, newWidth, newHeight);
					canvas.toBlob(resolve, file.type);
				}
			};
			image.onerror = reject;
		});
	}

	private calculateFileImageWidth(image: HTMLImageElement, maxWidth: number, maxHeight: number): number {
		let newImageWidth: number;
		if (image.width > image.height) {
			newImageWidth = maxWidth;
		} else {
			newImageWidth = image.width * (maxHeight / image.height);
		}
		return newImageWidth;
	}

	private calculateFileImageHeight(image: HTMLImageElement, maxWidth: number, maxHeight: number): number {
		let newImageHeight: number;
		if (image.width > image.height) {
			newImageHeight = image.height * (maxWidth / image.width);
		} else {
			newImageHeight = maxHeight;
		}
		return newImageHeight;
	}
}
