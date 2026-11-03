import { CanvasCardIdSchema, type CanvasCommand, type CanvasElement } from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import { buildCanvasDuplication, selectCanvasSubgraph } from '../../clipboard';
import type { CanvasElementActionSelection } from '../definitions/canvasElementActions';
import { buildAlignCommands, buildLayerCommands, buildLockCommands } from '../functions/buildCardLayoutCommands';

export function createCanvasElementActions(session: CanvasDocumentSession, selection: CanvasElementActionSelection) {
  const elements = () => session.state.snapshot.value?.elements ?? [];
  const commit = async (commands: readonly CanvasCommand[]) => { if (commands.length) await session.commit(commands); };
  return {
    lock: () => commit(buildLockCommands(elements(), selection.read())),
    layer: (direction: 'front' | 'back') => commit(buildLayerCommands(elements(), selection.read(), direction)),
    align: (mode: 'left' | 'top' | 'grid') => commit(buildAlignCommands(elements(), selection.read(), mode)),
    async duplicate(source: readonly CanvasElement[] = selectCanvasSubgraph(elements(), selection.read()), dx = 32, dy = 32) {
      const ids = source.filter(element => element.type !== 'edge').map(card => card.id);
      const plan = buildCanvasDuplication(source, ids, dx, dy);
      if (!plan.operations.length) return;
      const historyGroupId = crypto.randomUUID();
      const result = await session.commit(plan.operations, historyGroupId);
      const patches: CanvasCommand[] = [];
      for (const card of plan.cards) {
        const ref = plan.refs.get(card.id), newId = ref ? result.refs[ref] : undefined;
        const current = elements().find(element => element.id === newId);
        if (!current || current.type === 'edge') continue;
        const parentRef = card.parentId ? plan.refs.get(card.parentId) : undefined;
        const parentId = parentRef ? result.refs[parentRef] : undefined;
        // data包含自动高度等卡片专属设置；复制正文与子图结构后还原这些事实。
        patches.push({ op: 'update', id: current.id, baseRevision: current.revision, patch: { data: card.data, locked: card.locked,
          ...(parentId ? { parentId: CanvasCardIdSchema.parse(parentId) } : {}) } });
      }
      for (const [index, edge] of plan.edges.entries()) {
        if (edge.type !== 'edge' || edge.from.kind !== 'card' || edge.to.kind !== 'card') continue;
        const current = elements().find(element => element.id === result.refs[`$edge${index}`]);
        const fromRef = plan.refs.get(edge.from.cardId), toRef = plan.refs.get(edge.to.cardId);
        const fromId = fromRef ? result.refs[fromRef] : undefined, toId = toRef ? result.refs[toRef] : undefined;
        if (!current || current.type !== 'edge' || !fromId || !toId) continue;
        patches.push({ op: 'update', id: current.id, baseRevision: current.revision, patch: { color: edge.color, locked: edge.locked, lineStyle: edge.lineStyle, linePattern: edge.linePattern,
          from: { ...edge.from, cardId: CanvasCardIdSchema.parse(fromId) }, to: { ...edge.to, cardId: CanvasCardIdSchema.parse(toId) } } });
      }
      if (patches.length > 500) throw new Error('复制子图属性超过500项，请分批选择');
      if (patches.length) await session.commit(patches, historyGroupId);
      const newIds = plan.cards.flatMap(card => { const ref = plan.refs.get(card.id), id = ref ? result.refs[ref] : undefined; return id ? [CanvasCardIdSchema.parse(id)] : []; });
      await selection.select(newIds);
    },
    async connect() {
      const [from, to] = selection.read();
      if (!from || !to || selection.read().length !== 2) throw new Error('请选择两张卡片再连线');
      await session.commit([{ op: 'connect', from, to, label: '', direction: 'forward', lineStyle: 'curve', linePattern: 'solid' }]);
    },
    async resize(width: number, height: number) {
      const card = elements().find(element => element.id === selection.read()[0]);
      if (!card || card.type === 'edge' || card.locked || selection.read().length !== 1) return;
      await session.commit([{ op: 'update', id: card.id, baseRevision: card.revision, patch: { width: Math.max(80, width), height: Math.max(60, height), ...(card.type === 'text' ? { data: { ...card.data, heightMode: 'fixed' } } : {}) } }]);
    },
  };
}
