import { IRecentProjectItem } from '../../shared';

export type ElectronFile = File & { path?: string; webkitRelativePath?: string };
export interface IRecentProjectViewModel extends IRecentProjectItem {
	name: string;
}
