export type FileSystemWarningCode =
	| 'file-too-large'
	| 'max-files-reached'
	| 'unreadable-directory'
	| 'symlink-skipped';

export interface IFileSystemWarning {
	code: FileSystemWarningCode;
	message: string;
	filePath?: string;
}
