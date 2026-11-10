import { isDeepStrictEqual } from 'node:util';
import { CanvasCommitResultSchema } from '@plugin/canvas/shared';
import {
  CanvasToolTraceFactsSchema,
  type CanvasToolTraceFacts,
} from '../definitions/canvasToolTrace';
import { CanvasReceiptWitnessSchema } from '../definitions/canvasReceiptWitness';
import type { CanvasTraceWitnessScope } from '../definitions/traceDraft';

/** 回执只补权威提交，不替丢失stdout推断失败次数、修正、预检或模型看图。 */
export function admitCanvasReceiptWitness(input: {
  readonly value: unknown;
  readonly facts: CanvasToolTraceFacts;
  readonly scope: CanvasTraceWitnessScope;
  readonly projectId: string;
}) {
  if (input.value === undefined) return { facts: input.facts, evidenceFiles: [] };
  const witness = CanvasReceiptWitnessSchema.parse(input.value),
    facts = CanvasToolTraceFactsSchema.parse(input.facts);
  if (
    !isDeepStrictEqual(witness.scope, input.scope) ||
    witness.projectId !== input.projectId ||
    !facts.scope.locators.includes(witness.documentPath)
  )
    throw new Error('Receipt witness belongs to another evaluation run or project');
  const diagnostic = (code: string, sourceFile: string) => {
    facts.needsReview = true;
    facts.diagnostics.push({
      code,
      sourceFile,
      message: '回执见证未能无歧义证明本次请求；保留原始记录待核验',
    });
  };
  if (!witness.complete) diagnostic('receipt_witness_incomplete', 'receipt-witness.json');
  for (const query of witness.queries) {
    if (!facts.requests.some(request => request.requestId === query.requestId))
      throw new Error('Receipt request has no literal identity in this model run');
    const response = query.response,
      sourceFile = query.responseFile ?? 'receipt-witness.json';
    if (query.exitCode !== 0 || !response) {
      diagnostic('receipt_query_unavailable', sourceFile);
      continue;
    }
    if (
      response.documentId !== witness.documentPath ||
      (response.receipt && response.receipt.requestId !== query.requestId)
    )
      throw new Error('Receipt query response belongs to another document or request');
    const receipt = response.receipt;
    if (!receipt) {
      diagnostic('receipt_not_found', sourceFile);
      continue;
    }
    if (receipt.status !== 'committed') continue;
    if (!receipt.commit) {
      diagnostic('receipt_commit_missing', sourceFile);
      continue;
    }
    if (
      receipt.commit.documentId !== witness.documentPath ||
      receipt.commit.requestId !== query.requestId
    )
      throw new Error('Committed receipt belongs to another document or request');
    const commit = CanvasCommitResultSchema.parse({
      ...receipt.commit,
      documentId: input.scope.documentId,
    });
    const existing = facts.commits.find(existing => existing.requestId === commit.requestId);
    if (existing && !isDeepStrictEqual(existing, commit)) {
      diagnostic('receipt_conflicts_with_trace', sourceFile);
      continue;
    }
    if (!existing) facts.commits.push(commit);
  }
  facts.commits.sort((a, b) => a.sequence - b.sequence);
  return { facts, evidenceFiles: witness.evidenceFiles };
}
