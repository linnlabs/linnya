import type { KnowledgeBaseEvidenceItem, WebEvidenceItem } from '../../../definitions/evidence';

export interface EvidenceBundleScope {
  readonly conversationId: string;
  readonly instanceId: string;
}

export interface EvidenceBundleAudit {
  readonly turnId?: string;
  readonly toolCallId?: string;
}

interface SaveEvidenceBundleCommandBase {
  readonly scope: EvidenceBundleScope;
  readonly audit?: EvidenceBundleAudit;
  readonly query: string;
  readonly summary?: string;
}

export type SaveEvidenceBundleCommand =
  | (SaveEvidenceBundleCommandBase & {
      readonly kind: 'knowledge_evidence';
      readonly items: readonly KnowledgeBaseEvidenceItem[];
    })
  | (SaveEvidenceBundleCommandBase & {
      readonly kind: 'web_evidence';
      readonly items: readonly WebEvidenceItem[];
    });

export interface SavedEvidenceBundle {
  readonly bundleId: string;
  readonly filePath: string;
}
