export interface EvidenceHeaderPresentationData {
  readonly kind: 'lifecycle' | 'complete';
  readonly operation: 'write' | 'read';
}
