import type { SandboxJsonValue } from '@plugin/backend/sandboxRuntime';
import { isSandboxJsonObject } from '../../sandboxJson';
import type {
  LayoutTraceNode,
  LayoutTraceNodeType,
  LayoutTraceSnapshot,
} from '../definitions/layoutTrace';

const LAYOUT_TRACE_NODE_TYPES = new Set<string>([
  'Slide',
  'View',
  'Text',
  'Shape',
  'Chart',
  'Table',
  'Image',
  'SvgGraphic',
  'Formula',
  'Spacer',
]);

export function readLayoutTrace(value: SandboxJsonValue | undefined): LayoutTraceSnapshot | null {
  if (!isSandboxJsonObject(value) || value['version'] !== 1) return null;
  if (typeof value['truncated'] !== 'boolean') return null;

  const rawNodes = value['nodes'];
  const rawRoots = value['roots'];
  if (!Array.isArray(rawNodes) || !Array.isArray(rawRoots)) return null;

  const nodes: LayoutTraceNode[] = [];
  for (const rawNode of rawNodes) {
    const node = readLayoutTraceNode(rawNode);
    if (!node) return null;
    nodes.push(node);
  }

  const roots: number[] = [];
  for (const rawRoot of rawRoots) {
    if (!isPositiveInteger(rawRoot)) return null;
    roots.push(rawRoot);
  }

  return {
    version: 1,
    truncated: value['truncated'],
    nodes,
    roots,
  };
}

function readLayoutTraceNode(value: SandboxJsonValue): LayoutTraceNode | null {
  if (!isSandboxJsonObject(value)) return null;

  const id = value['id'];
  const type = value['type'];
  const startLine = value['startLine'];
  const endLine = value['endLine'];
  const rawChildren = value['children'];
  const configured = value['configured'];
  const content = value['content'];

  if (!isPositiveInteger(id)) return null;
  if (!isLayoutTraceNodeType(type)) return null;
  if (!isPositiveInteger(startLine) || !isPositiveInteger(endLine) || endLine < startLine) return null;
  if (!Array.isArray(rawChildren)) return null;
  if (typeof configured !== 'boolean' || typeof content !== 'boolean') return null;

  const children: number[] = [];
  for (const rawChild of rawChildren) {
    if (!isPositiveInteger(rawChild)) return null;
    children.push(rawChild);
  }

  return {
    id,
    type,
    startLine,
    endLine,
    children,
    configured,
    content,
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isLayoutTraceNodeType(value: unknown): value is LayoutTraceNodeType {
  return typeof value === 'string' && LAYOUT_TRACE_NODE_TYPES.has(value);
}
