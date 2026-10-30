import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const DEFAULT_NAMESPACE = 'common';

void i18n.use(initReactI18next).init({ defaultNS: DEFAULT_NAMESPACE, lng: 'en' });
