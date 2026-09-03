import type { CitationSequence } from '../definitions/citationSequence';

const sequenceByToolContext = new WeakMap<object, CitationSequence>();

/** Host 在 citation producer 执行前绑定本次调用的确定性顺序事实。 */
export function attachCitationSequence(
  toolContext: object,
  sequence: CitationSequence,
): void {
  if (!Number.isInteger(sequence.offset) || sequence.offset < 0) {
    throw new Error('Citation sequence offset must be a non-negative integer.');
  }
  sequenceByToolContext.set(toolContext, sequence);
}

/** Citation producer 必须显式取得 host admission，禁止用 0 掩盖缺失的执行链。 */
export function requireCitationSequenceOffset(toolContext: object): number {
  const sequence = sequenceByToolContext.get(toolContext);
  if (!sequence) {
    throw new Error('Citation producer requires a host-admitted citation sequence.');
  }
  return sequence.offset;
}

/** 派生 ToolContext 时保留同一次工具执行的 Citation 顺序事实。 */
export function copyCitationSequence(source: object, target: object): void {
  const sequence = sequenceByToolContext.get(source);
  if (sequence) sequenceByToolContext.set(target, sequence);
}
