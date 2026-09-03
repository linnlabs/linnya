import { computed, type ComputedRef } from 'vue';
import { useLocalization } from '@app/localization';
import { useCreatableDocumentTypes } from '../composables';
import type { DocumentTypeContribution } from '../types';
import {
  resolveDocumentTypeTextPresentation,
  type DocumentTypeTextPresentation,
} from '../functions/pluginContributionPresentation';

export interface LocalizedDocumentTypeContribution extends DocumentTypeContribution {
  readonly localizedText: DocumentTypeTextPresentation;
}

export function useLocalizedCreatableDocumentTypes(): ComputedRef<readonly LocalizedDocumentTypeContribution[]> {
  const documentTypes = useCreatableDocumentTypes();
  const { t } = useLocalization();

  return computed(() => documentTypes.value.map((documentType) => ({
    ...documentType,
    localizedText: resolveDocumentTypeTextPresentation(documentType, t),
  })));
}
