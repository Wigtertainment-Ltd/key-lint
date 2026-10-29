import { useTranslation } from 'react-i18next';

export function App() {
	const { t } = useTranslation();
	const { t: common } = useTranslation('common');
	const { t: admin } = useTranslation(['admin', 'common']);
	const { t: prefixed } = useTranslation('common', { keyPrefix: 'section' });

	return [
		t('app.title'),
		common('save'),
		common('shared'),
		admin('save'),
		admin('shared'),
		t('admin:title'),
		t('save', { ns: 'admin', keyPrefix: 'buttons' }),
		prefixed('title'),
		prefixed('save', { keyPrefix: '' }),
		prefixed('admin:title', { keyPrefix: '' }),
		common('missing')
	];
}
