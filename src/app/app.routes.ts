import { Routes } from '@angular/router';
import { ProjectSelectionPage } from './pages/project-selection/project-selection.page';
import { ScanProgressPage } from './pages/scan-progress/scan-progress.page';
import { AnalysisLayoutPage } from './pages/analysis-layout/analysis-layout.page';
import { HistoryPage } from './pages/history/history.page';
import { ResultsOverviewPage } from './pages/results-overview/results-overview.page';
import { TranslationKeysPage } from './pages/translation-keys/translation-keys.page';
import { DocumentationPage } from './pages/documentation/documentation.page';
import { DashboardPage } from './pages/dashboard/dashboard.page';

export const routes: Routes = [
	{
		path: '',
		component: ProjectSelectionPage
	},
	{
		path: 'scan-progress',
		component: ScanProgressPage
	},
	{
		path: 'analysis',
		component: AnalysisLayoutPage,
		children: [
			{
				path: '',
				redirectTo: 'dashboard',
				pathMatch: 'full'
			},
			{
				path: 'dashboard',
				component: DashboardPage
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
			},
			{
				path: 'documentation',
				component: DocumentationPage
			}
		]
	},
	{
		path: '**',
		redirectTo: ''
	}
];
