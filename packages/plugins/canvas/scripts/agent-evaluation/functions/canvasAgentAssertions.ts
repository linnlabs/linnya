import { isDeepStrictEqual } from 'node:util';
import { readCanvasElementText, type CanvasCard, type CanvasContentNode, type CanvasElement, type CanvasSnapshot } from '../../../src/shared';
import type { CanvasAgentAssertion, CanvasAgentEvaluationRun } from '../definitions/canvasAgentEvaluation';
import { architectureDependencies, architectureModules } from './createCanvasAgentFixture';

export function assertion(rule: string, passed: boolean, detail: string): CanvasAgentAssertion { return { rule, passed, detail }; }
export function cards(snapshot: CanvasSnapshot): CanvasCard[] { return snapshot.elements.filter((element): element is CanvasCard => element.type !== 'edge'); }
export function linked(snapshot: CanvasSnapshot, from: string, to: string): boolean {
  return snapshot.elements.some(element => element.type === 'edge' && element.from.kind === 'card' && element.from.cardId === from && element.to.kind === 'card' && element.to.cardId === to);
}
export function originalCardsUnchanged(run: CanvasAgentEvaluationRun, positionalOnly = false): boolean {
  const after = new Map(run.after.elements.map(element => [element.id, element]));
  const omit = positionalOnly ? new Set(['x', 'y', 'revision', 'updatedBy', 'updatedAt']) : new Set<string>();
  const content = (element: CanvasElement) => Object.fromEntries(Object.entries(element).filter(([field]) => !omit.has(field)));
  return cards(run.before).every(card => { const next = after.get(card.id); return next !== undefined && isDeepStrictEqual(content(card), content(next)); });
}
export function treeDepth(run: CanvasAgentEvaluationRun): number | null {
  const nodes = cards(run.after), root = cards(run.before)[0]; if (!root) return null;
  const edges = run.after.elements.filter(element => element.type === 'edge');
  if (edges.length !== nodes.length - 1) return null;
  const adjacency = new Map<string, string[]>(nodes.map(node => [node.id, []])); const incoming = new Map<string, number>();
  for (const edge of edges) {
    if (edge.from.kind !== 'card' || edge.to.kind !== 'card') return null;
    adjacency.get(edge.from.cardId)?.push(edge.to.cardId); incoming.set(edge.to.cardId, (incoming.get(edge.to.cardId) ?? 0) + 1);
  }
  if (incoming.has(root.id) || nodes.some(node => node.id !== root.id && incoming.get(node.id) !== 1)) return null;
  const queue = [{ id: String(root.id), depth: 0 }], visited = new Set<string>(); let maximum = 0;
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index]; if (visited.has(item.id)) return null;
    visited.add(item.id); maximum = Math.max(maximum, item.depth);
    for (const id of adjacency.get(item.id) ?? []) queue.push({ id, depth: item.depth + 1 });
  }
  return visited.size === nodes.length ? maximum : null;
}
export function architectureCorrect(run: CanvasAgentEvaluationRun): boolean {
  const nodes = cards(run.after), names = new Map<string, string>();
  for (const module of architectureModules) {
    const matches = nodes.filter(node => readCanvasElementText(node).split('\n')[0].includes(module));
    if (matches.length !== 1) return false;
    names.set(module, matches[0].id);
  }
  const edges = run.after.elements.filter(element => element.type === 'edge');
  return nodes.length === 8 && edges.length === architectureDependencies.length && architectureDependencies.every(([from, to]) => { const fromId = names.get(from), toId = names.get(to); return fromId !== undefined && toId !== undefined && linked(run.after, fromId, toId); });
}
function hasCitation(node: CanvasContentNode): boolean {
  return Boolean(node.text?.match(/https:\/\/\S+/)) || (node.marks ?? []).some(mark => mark.type === 'link' && typeof mark.attrs?.href === 'string' && mark.attrs.href.startsWith('https://')) || (node.content ?? []).some(hasCitation);
}
export function evidenceLinked(run: CanvasAgentEvaluationRun): boolean {
  const problem = cards(run.before)[0]; if (!problem) return false;
  const evidence = cards(run.after).filter(card => card.id !== problem.id);
  return evidence.length >= 3 && evidence.every(card => card.type === 'text' && hasCitation(card.data.content) && linked(run.after, card.id, problem.id));
}
export function sceneSequence(run: CanvasAgentEvaluationRun): boolean {
  const nodes = cards(run.after), codes = Array.from({ length: 12 }, (_, index) => `A${Math.floor(index / 4) + 1}S${index % 4 + 1}`);
  const ordered = codes.map(code => nodes.filter(node => readCanvasElementText(node).includes(code)));
  return nodes.length === 12 && ordered.every(matches => matches.length === 1) && ordered.slice(1).every((matches, index) => linked(run.after, ordered[index][0].id, matches[0].id));
}
export function pendingTargetsCorrect(run: CanvasAgentEvaluationRun): boolean {
  const after = new Map(run.after.elements.map(element => [element.id, element]));
  return cards(run.before).every(card => {
    const next = after.get(card.id); if (!next) return false;
    const text = readCanvasElementText(card);
    return text.includes('待定') ? next.color === 'yellow' && readCanvasElementText(next) === '【待定】' + text : isDeepStrictEqual(card, next);
  });
}
