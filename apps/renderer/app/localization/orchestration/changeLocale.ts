import type { LinnyaLocale } from '../definitions/locale';
import { useLocalizationStore } from '../store/localizationStore';

export function changeLocale(locale: LinnyaLocale): void {
  useLocalizationStore().setCurrentLocale(locale);
}
