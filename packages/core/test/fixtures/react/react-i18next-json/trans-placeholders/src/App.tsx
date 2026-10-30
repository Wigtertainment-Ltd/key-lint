import { Trans, useTranslation } from 'react-i18next';

export function App({ name, user, runtimeValues, price, html }) {
	const { t } = useTranslation('common');
	return <>
		{t('good', { name })}
		{t('missing')}
		{t('nested', { user })}
		<Trans ns="common" i18nKey="uncertain" values={runtimeValues} />
		<Trans ns="common" i18nKey="mismatch" values={{ name }} />
		<Trans ns="common" i18nKey="formatted" values={{ price, html }} />
		<Trans t={t} i18nKey="child">Hello <strong>{{ name }}</strong></Trans>
		<Trans ns="common" i18nKey="notDefined" />
	</>;
}
