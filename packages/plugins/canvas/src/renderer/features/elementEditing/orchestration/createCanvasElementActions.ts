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
      const plan = buildCanvasDuplication({ elements: source, ids, dx, dy, allocateReferenceId: () => crypto.randomUUID() });
      if (!plan.operations.length) return;
      const result = await session.commit(plan.operations);
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
