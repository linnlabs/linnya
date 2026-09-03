import type { LocalizedText } from '@app/localization';
import type {
  ConversationAgentChoiceContribution,
  DocumentTypeContribution,
} from '../types';

export type LocalizedTextResolver = (text: LocalizedText) => string;

export interface DocumentTypeTextPresentation {
  readonly label: string;
  readonly createLabel: string;
  readonly defaultName: string;
}

export interface ConversationAgentChoiceTextPresentation {
  readonly menuText: string;
  readonly pillText: string;
  readonly ariaLabel: string;
}

export function resolveDocumentTypeTextPresentation(
  documentType: DocumentTypeContribution,
  resolveText: LocalizedTextResolver,
): DocumentTypeTextPresentation {
  return {
    label: resolveText(documentType.labelText ?? documentType.label),
    createLabel: resolveText(documentType.createLabelText ?? documentType.createLabel),
    defaultName: resolveText(documentType.defaultNameText ?? documentType.defaultName),
  };
}

export function resolveConversationAgentChoiceTextPresentation(
  agentChoice: ConversationAgentChoiceContribution,
  resolveText: LocalizedTextResolver,
): ConversationAgentChoiceTextPresentation {
  return {
    menuText: resolveText(agentChoice.menuLocalizedText ?? agentChoice.menuText),
    pillText: resolveText(agentChoice.pillLocalizedText ?? agentChoice.pillText),
    ariaLabel: resolveText(agentChoice.ariaLocalizedText ?? agentChoice.ariaLabel),
  };
}
