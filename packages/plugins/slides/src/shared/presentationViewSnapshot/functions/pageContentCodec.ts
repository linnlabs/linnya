import type { JsonValue } from '@app/schemas';
import type { RenderNode, RenderNodeBase, SlideRenderModel } from '../../renderModel';
import { isSlideRenderModel } from '../../renderModel';

export type ViewJsonRecord = { [key: string]: JsonValue };
const bindingFields: ReadonlySet<string> = new Set([
  'id', 'editableTarget', 'authoringRef', 'authoringAncestorRefs', 'sourceSpan',
  'diagnosticsRefIds',
] satisfies readonly (keyof RenderNodeBase)[]);
const locatorFields = new Set(['nodeId', 'label', 'parentNodeId', 'sourceSpan', 'layoutNodeId']);

/** 固定键序并省略可选缺席字段；不把非法值静默转换为 null。 */
export function toViewJson(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(toViewJson);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const result: ViewJsonRecord = {};
    for (const [key, item] of Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      if (item !== undefined) Object.defineProperty(result, key, { value: toViewJson(item), enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  throw new Error('Slides view contains a non-JSON value');
}

export function viewRecord(value: unknown): ViewJsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Slides view record expected');
  const result = toViewJson(value);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Slides view record expected');
  return result;
}

function readRecord(value: JsonValue | undefined): ViewJsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Slides view record expected');
  return value;
}

// 只递归布局追踪合同，不能递归删除图表等业务数据中的 id。
function splitEvidence(value: ViewJsonRecord): { content: ViewJsonRecord; binding: ViewJsonRecord } {
  const content: ViewJsonRecord = {};
  const binding: ViewJsonRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (locatorFields.has(key)) binding[key] = item;
    else if (key === 'parent' || key === 'parentConstraint') {
      const parts = splitEvidence(viewRecord(item));
      content[key] = parts.content;
      binding[key] = parts.binding;
    } else content[key] = item;
  }
  return { content, binding };
}

function mergeEvidence(content: ViewJsonRecord, binding: ViewJsonRecord): ViewJsonRecord {
  const result = { ...content, ...binding };
  for (const key of ['parent', 'parentConstraint']) {
    if (content[key] !== undefined) result[key] = mergeEvidence(readRecord(content[key]), readRecord(binding[key]));
  }
  return result;
}

export function splitSlideContent(slide: SlideRenderModel): { content: ViewJsonRecord; binding: ViewJsonRecord } {
  const bindings: ViewJsonRecord[] = [];
  function splitNode(node: RenderNode): ViewJsonRecord {
    const content: ViewJsonRecord = {};
    const binding: ViewJsonRecord = {};
    bindings.push(binding);
    for (const [key, value] of Object.entries(node)) {
      if (value === undefined || key === 'children' || key === 'innerText') continue;
      if (key === 'layoutConstraintEvidence') {
        const parts = splitEvidence(viewRecord(value));
        content[key] = parts.content;
        binding[key] = parts.binding;
      } else (bindingFields.has(key) ? binding : content)[key] = toViewJson(value);
    }
    if (node.kind === 'group') content.children = node.children.map(splitNode);
    if (node.kind === 'shape' && node.innerText) content.innerText = splitNode(node.innerText);
    return content;
  }
  const { diagnostics, elements } = slide;
  const facts = { layoutKey: slide.layoutKey, background: slide.background,
    ...(slide.referencePreview ? { referencePreview: slide.referencePreview } : {}) };
  return {
    content: { ...viewRecord(facts), elements: elements.map(splitNode),
      ...(slide.layoutReplay ? { layoutReplay: { nodes: slide.layoutReplay.nodes.map(({ id: _id, ...node }) => toViewJson(node)) } } : {}) },
    binding: { nodes: bindings, ...(diagnostics ? { diagnostics: toViewJson(diagnostics) } : {}),
      ...(slide.layoutReplay ? { layoutIds: slide.layoutReplay.nodes.map(node => node.id) } : {}) },
  };
}

export function restoreSlideContent(
  content: ViewJsonRecord, binding: ViewJsonRecord, slideId: string, index: number,
): SlideRenderModel {
  const entries = binding.nodes;
  if (!Array.isArray(entries)) throw new Error('Slides page bindings are missing');
  const bindings = entries;
  let cursor = 0;
  function restoreNode(value: JsonValue): ViewJsonRecord {
    const body = readRecord(value);
    const identity = readRecord(bindings[cursor++]);
    const result = { ...body, ...identity };
    if (body.layoutConstraintEvidence) result.layoutConstraintEvidence = mergeEvidence(
      readRecord(body.layoutConstraintEvidence), readRecord(identity.layoutConstraintEvidence));
    if (body.kind === 'group') {
      if (!Array.isArray(body.children)) throw new Error('Slides group children are missing');
      result.children = body.children.map(restoreNode);
    }
    if (body.kind === 'shape' && body.innerText) result.innerText = restoreNode(body.innerText);
    return result;
  }
  if (!Array.isArray(content.elements)) throw new Error('Slides page elements are missing');
  let layoutReplay: ViewJsonRecord | undefined;
  if (content.layoutReplay) {
    const nodes = readRecord(content.layoutReplay).nodes;
    const ids = binding.layoutIds;
    if (!Array.isArray(nodes) || !Array.isArray(ids) || nodes.length !== ids.length) throw new Error('Slides layout bindings are missing');
    layoutReplay = { nodes: nodes.map((node, position) => ({ ...readRecord(node), id: ids[position] })) };
  }
  const result = { ...content, slideId, index, elements: content.elements.map(restoreNode),
    ...(layoutReplay ? { layoutReplay } : {}),
    ...(binding.diagnostics ? { diagnostics: binding.diagnostics } : {}) };
  if (cursor !== bindings.length || !isSlideRenderModel(result)) throw new Error('Slides page content/binding mismatch');
  return result;
}
