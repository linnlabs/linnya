import {
  canvasTextPrefix,
  type CanvasElement,
  type CanvasElementChange,
  type CanvasElementId,
  type CanvasSnapshot,
  type CanvasSource,
} from '../../../../shared';
import {
  describeCanvasEdge,
  formatCanvasTime,
  projectCanvasCardBody,
  type CanvasProjectionContext,
} from '../../canvasProjection';

const CHANGE_LIMIT = 200;

/** 变化日志里的一次提交（序号、来源、逐元素变化与提交时刻）。 */
interface CanvasLoggedCommit {
  readonly sequence: number;
  readonly source: CanvasSource;
  readonly changes: readonly CanvasElementChange[];
  readonly committedAt: number;
}
const TEXT_LIMIT = 120;

interface ElementChange {
  readonly before: CanvasElement | null;
  after: CanvasElement | null;
  readonly fields: Set<string>;
  last: CanvasLoggedCommit;
}

/** 一个范围内每个元素的净变化：先加后删不出现，多次修改合并字段，来源与时间取最后一次。 */
function foldChanges(commits: readonly CanvasLoggedCommit[]) {
  const changes = new Map<CanvasElementId, ElementChange>();
  for (const commit of commits)
    for (const change of commit.changes) {
      const current = changes.get(change.id);
      if (!current) {
        changes.set(change.id, {
          before: change.before,
          after: change.after,
          fields: new Set(change.fields),
          last: commit,
        });
        continue;
      }
      current.after = change.after;
      current.last = commit;
      for (const field of change.fields) current.fields.add(field);
    }
  return [...changes.entries()].filter(([, change]) => change.before || change.after);
}

/** 只读查询：某提交序号之后谁加了、改了、删了什么。只说明来源是用户还是 Agent、是否本对话，不暴露对话或运行身份。 */
export function queryCanvasChanges(input: {
  readonly snapshot: CanvasSnapshot;
  readonly context: CanvasProjectionContext;
  readonly commits: readonly CanvasLoggedCommit[];
  readonly afterSequence: number;
  readonly complete: boolean;
  readonly currentConversationId: string | null;
}) {
  const current = new Map(input.snapshot.elements.map(element => [element.id, element]));
  const changes = foldChanges(input.commits).map(([id, change]) => {
    const element = current.get(id) ?? change.after ?? change.before!;
    const kind = !change.before ? 'added' : !change.after ? 'removed' : 'updated';
    const source = change.last.source;
    const body =
      element.type === 'edge'
        ? describeCanvasEdge(element)
        : projectCanvasCardBody(element, input.context);
    return {
      id,
      type: element.type,
      change: kind,
      ...(kind === 'updated' ? { fields: [...change.fields] } : {}),
      by:
        source.kind === 'user'
          ? { kind: 'user' as const }
          : {
              kind: 'agent' as const,
              currentConversation: source.conversationId === input.currentConversationId,
            },
      sequence: change.last.sequence,
      at: formatCanvasTime(change.last.committedAt),
      text: canvasTextPrefix(body, TEXT_LIMIT),
    };
  });
  const count = (kind: string) => changes.filter(change => change.change === kind).length;
  return {
    fromSequence: input.afterSequence,
    sequence: input.snapshot.sequence,
    complete: input.complete,
    ...(input.complete
      ? {}
      : { note: '更早的变化记录已裁剪，这里只含仍保留的部分；需要全貌请用 read 读取当前画布。' }),
    total: { added: count('added'), updated: count('updated'), removed: count('removed') },
    changes: changes.slice(0, CHANGE_LIMIT),
    ...(changes.length > CHANGE_LIMIT ? { truncated: changes.length - CHANGE_LIMIT } : {}),
  };
}
