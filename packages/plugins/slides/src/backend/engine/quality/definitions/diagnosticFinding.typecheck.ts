import type { DiagnosticFinding } from './diagnosticFinding';

declare const common: Omit<DiagnosticFinding, 'code' | 'evidence'>;

const invalidCodeEvidencePair = {
  ...common,
  code: 'element_overlap',
  evidence: {
    kind: 'text_layout',
    issue: 'overflow',
  },
} as const;

// @ts-expect-error element_overlap 必须携带 node_overlap evidence，不能只靠运行时发现错配。
const _invalidFinding: DiagnosticFinding = invalidCodeEvidencePair;
