import type { DocumentNodeTypeAvailability } from '../registry';
import type { DocumentTypeContribution } from '../types';

export interface DocumentTypeUnavailableMessageResolver {
  readonly disabled: (params: { documentType: string; pluginName: string }) => string;
  readonly missing: (params: { documentType: string; pluginName: string }) => string;
  readonly loadFailed: (params: { documentType: string; pluginName: string }) => string;
  readonly unknown: (params: { nodeType: string }) => string;
  readonly fallback: () => string;
}

export type DocumentTypeLabelResolver = (documentType: DocumentTypeContribution) => string;

function resolveUnavailableDocumentTypeLabel(
  availability: DocumentNodeTypeAvailability,
  resolveDocumentTypeLabel?: DocumentTypeLabelResolver,
): string {
  if (
    'documentType' in availability &&
    availability.documentType &&
    resolveDocumentTypeLabel
  ) {
    return resolveDocumentTypeLabel(availability.documentType);
  }
  if ('label' in availability) return availability.label;
  if (availability.state === 'unknown') return availability.nodeType;
  return resolveDocumentTypeLabel?.(availability.documentType) ?? availability.documentType.label;
}

export function buildDocumentTypeUnavailableMessage(
  availability: DocumentNodeTypeAvailability,
  message: DocumentTypeUnavailableMessageResolver,
  resolveDocumentTypeLabel?: DocumentTypeLabelResolver,
): string | null {
  if (availability.state === 'disabled') {
    return message.disabled({
      documentType: resolveUnavailableDocumentTypeLabel(availability, resolveDocumentTypeLabel),
      pluginName: availability.pluginName,
    });
  }
  if (availability.state === 'missing') {
    return message.missing({
      documentType: resolveUnavailableDocumentTypeLabel(availability, resolveDocumentTypeLabel),
      pluginName: availability.pluginName,
    });
  }
  if (availability.state === 'load-failed') {
    return message.loadFailed({
      documentType: resolveUnavailableDocumentTypeLabel(availability, resolveDocumentTypeLabel),
      pluginName: availability.pluginName,
    });
  }
  if (availability.state === 'unknown') {
    return message.unknown({ nodeType: availability.nodeType });
  }
  return null;
}

export function getDocumentTypeUnavailableMessage(
  availability: DocumentNodeTypeAvailability,
  message: DocumentTypeUnavailableMessageResolver,
  resolveDocumentTypeLabel?: DocumentTypeLabelResolver,
): string {
  return buildDocumentTypeUnavailableMessage(
    availability,
    message,
    resolveDocumentTypeLabel,
  ) ?? message.fallback();
}
