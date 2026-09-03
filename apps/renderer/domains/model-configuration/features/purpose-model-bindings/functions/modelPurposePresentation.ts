import type { SettingsMessageKey } from '@/domains/settings/public';

import type { AuxiliaryModelPurposeKey } from '../definitions/modelPurposes';

const PURPOSE_MESSAGE_KEYS: Readonly<Record<
  AuxiliaryModelPurposeKey,
  { readonly label: SettingsMessageKey; readonly description: SettingsMessageKey }
>> = {
  autocomplete: {
    label: 'settings.modelConfig.auxiliary.purposes.autocomplete.label',
    description: 'settings.modelConfig.auxiliary.purposes.autocomplete.description',
  },
  translation: {
    label: 'settings.modelConfig.auxiliary.purposes.translation.label',
    description: 'settings.modelConfig.auxiliary.purposes.translation.description',
  },
  audio_summary: {
    label: 'settings.modelConfig.auxiliary.purposes.audioSummary.label',
    description: 'settings.modelConfig.auxiliary.purposes.audioSummary.description',
  },
  writing: {
    label: 'settings.modelConfig.auxiliary.purposes.writing.label',
    description: 'settings.modelConfig.auxiliary.purposes.writing.description',
  },
  annotation: {
    label: 'settings.modelConfig.auxiliary.purposes.annotation.label',
    description: 'settings.modelConfig.auxiliary.purposes.annotation.description',
  },
  review: {
    label: 'settings.modelConfig.auxiliary.purposes.review.label',
    description: 'settings.modelConfig.auxiliary.purposes.review.description',
  },
  conversation_title: {
    label: 'settings.modelConfig.auxiliary.purposes.conversationTitle.label',
    description: 'settings.modelConfig.auxiliary.purposes.conversationTitle.description',
  },
  knowledge_graph_extraction: {
    label: 'settings.modelConfig.auxiliary.purposes.knowledgeGraphExtraction.label',
    description: 'settings.modelConfig.auxiliary.purposes.knowledgeGraphExtraction.description',
  },
};

export function modelPurposeLabelKey(purposeKey: AuxiliaryModelPurposeKey): SettingsMessageKey {
  return PURPOSE_MESSAGE_KEYS[purposeKey].label;
}

export function modelPurposeDescriptionKey(
  purposeKey: AuxiliaryModelPurposeKey,
): SettingsMessageKey {
  return PURPOSE_MESSAGE_KEYS[purposeKey].description;
}
