import type { CitationSequenceEvent } from '../definitions/citationSequence';
import { isRecord } from '@linnya/foundation';

/**
 * 统计本 turn 已被接纳的 citation 数量。
 *
 * 这里刻意只解释 Linnya producer 的 `data.citations.citations` 业务合同；Linnkit 不应知道
 * 该字段。working history 会在每次工具执行前更新，因此串行工具调用可以自然连续编号。
 */
export function computeTurnCitationOffset(
  events: ReadonlyArray<CitationSequenceEvent>,
  turnId: string,
): number {
  let offset = 0;

  for (const event of events) {
    if (event.type !== 'tool_output' || event.turn_id !== turnId || !isRecord(event.data)) {
      continue;
    }
    const metadata = event.data['citations'];
    if (!isRecord(metadata)) {
      continue;
    }
    const citations = metadata['citations'];
    if (Array.isArray(citations)) {
      offset += citations.length;
    }
  }

  return offset;
}
