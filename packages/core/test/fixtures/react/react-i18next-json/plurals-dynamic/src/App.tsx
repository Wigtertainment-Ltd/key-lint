import { Trans, useTranslation } from 'react-i18next';

export function App({ count, state }) {
	const { t } = useTranslation('common');
	return <>
		{t('items', { count })}
		<Trans t={t} i18nKey="items" count={count} />
		{t('title')}
		{t(`status.${state}`)}
		<Trans t={t} i18nKey={'status.' + state} />
		{t('missing', { count: 2 })}
	</>;
}
