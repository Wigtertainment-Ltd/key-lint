import type { IProjectHistoryEvent } from '@key-lint/core';

export interface IHistoryDayGroup {
	label: string;
	events: IProjectHistoryEvent[];
}
