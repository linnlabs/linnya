import ELK from 'elkjs/lib/elk.bundled.js';
import { CanvasCardIdSchema } from '../../../../../shared';
import type { CanvasLayoutAlgorithm } from '../../definitions/canvasLayoutPlan';

const engine = new ELK();
/** ELK只在layout worker运行；不进入Backend主线程或Renderer包。 */
export const layoutCanvasLayered: CanvasLayoutAlgorithm = async (cards, edges, options) => {
  const result = await engine.layout({ id: 'canvas-layout', layoutOptions: {
    'elk.algorithm': 'layered', 'elk.direction': options.direction === 'right' ? 'RIGHT' : 'DOWN',
    'elk.spacing.nodeNode': '40', 'elk.layered.spacing.nodeNodeBetweenLayers': '80',
    'elk.randomSeed': '1', 'elk.separateConnectedComponents': 'true',
  }, children: cards.map(card => ({ id: card.id, width: card.width, height: card.height })),
  edges: edges.flatMap(edge => edge.from.kind === 'card' && edge.to.kind === 'card'
    ? [{ id: edge.id, sources: [edge.from.cardId], targets: [edge.to.cardId] }] : []),
  });
  return (result.children ?? []).map(node => {
    if (node.x === undefined || node.y === undefined || !Number.isFinite(node.x) || !Number.isFinite(node.y)) throw new Error('canvas_layout_position_missing');
    return { id: CanvasCardIdSchema.parse(node.id), x: node.x, y: node.y };
  });
};
