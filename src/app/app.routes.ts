import { Routes } from '@angular/router';
import { ProjectSelectionPage } from './pages/project-selection/project-selection.page';
import { ScanProgressPage } from './pages/scan-progress/scan-progress.page';
import { AnalysisLayoutPage } from './pages/analysis-layout/analysis-layout.page';
import { HistoryPage } from './pages/history/history.page';
import { ResultsOverviewPage } from './pages/results-overview/results-overview.page';
import { TranslationKeysPage } from './pages/translation-keys/translation-keys.page';

export const routes: Routes = [
	{
		path: '',
		component: ProjectSelectionPage
	},
	{
		path: 'scan-progress',
		component: AnalysisLayoutPage,
		children: [
			{
				path: '',
				component: ScanProgressPage
			},
			{
				path: 'translation-keys',
				component: TranslationKeysPage
			},
			{
				path: 'results',
				component: ResultsOverviewPage
			},
			{
				path: 'history',
				component: HistoryPage
			}
		]
	},
	{
		path: '**',
		redirectTo: ''
	}
];
