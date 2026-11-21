import type {
  Document as XmlDocument,
  Element as XmlElement,
  Node as XmlNode,
} from '@xmldom/xmldom';

/**
 * 一个 part（slide / layout / master / notes）内的对象编号（`p:cNvPr/@id`）处理。
 * 连接线（`a:stCxn` / `a:endCxn`）、动画（`p:spTgt/@spid`、`p:bldP/@spid`）、
 * 现代批注的形状锚点都按编号引用形状，所以编号只能在确有必要时才改。
 */

const PML_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** `ST_DrawingElementId` 是 unsignedInt；0 与非数字都不是有效编号。 */
const MAX_OBJECT_ID = 4_294_967_295;

/**
 * 生成稿：把全部 `cNvPr` 重排成 1..n。PptxGenJS 产出的稿子里没有按编号引用形状的连接线或动画，
 * 重排只用来消除它偶发的重号。导入稿禁止调用，见 {@link resolveObjectIdConflicts}。
 */
export function renumberObjectIds(doc: XmlDocument): boolean {
  const elements = [
    ...Array.from(doc.getElementsByTagName('p:cNvPr')),
    ...Array.from(doc.getElementsByTagName('cNvPr')),
  ] as XmlElement[];

  let changed = false;
  let nextId = 1;
  for (const element of elements) {
    if (element.getAttribute('id') !== String(nextId)) {
      element.setAttribute('id', String(nextId));
      changed = true;
    }
    nextId += 1;
  }
  return changed;
}

/**
 * 导入稿：保留作者已有的编号，只给冲突（同一 part 内第二个及之后的同号对象）或缺失、非法编号的对象
 * 分配新编号：新编号取该 part 当前最大编号之后的连续值，不会与任何已有编号相撞。
 *
 * - 第一个持有某编号的对象保留它，指向该编号的连接线与动画因此不动。
 * - `mc:Fallback` 里的对象镜像同级 `mc:Choice` 的同一个对象，与 Choice 同号是合法的，不算冲突。
 * - 整块对象（如粘贴来的组）里的编号被改后，同一块对象内部的连接线端点同步改写，
 *   仍连着块内被改号的形状。块外的引用（含 `p:timing`）无法判断该指向哪一个同号对象，一律不改。
 */
export function resolveObjectIdConflicts(doc: XmlDocument): boolean {
  const elements = Array.from(doc.getElementsByTagNameNS(PML_NS, 'cNvPr')) as XmlElement[];
  if (elements.length === 0) return false;

  const ids = elements.map((element) => parseObjectId(element.getAttribute('id')));
  let maxId = 0;
  for (const id of ids) {
    if (id !== undefined && id > maxId) maxId = id;
  }

  const claimed = new Set<number>();
  const blocks = new Map<XmlNode, BlockIds>();
  let changed = false;
  elements.forEach((element, index) => {
    const id = ids[index];
    const block = blockOf(element);
    if (id !== undefined && !claimed.has(id)) {
      claimed.add(id);
      if (block) blockIdsOf(blocks, block).kept.add(id);
      return;
    }
    if (id !== undefined && isInsideFallback(element)) return;
    if (maxId >= MAX_OBJECT_ID) {
      throw new Error('PPTX object ids are exhausted; cannot allocate a conflict-free id.');
    }
    maxId += 1;
    claimed.add(maxId);
    element.setAttribute('id', String(maxId));
    changed = true;
    if (id !== undefined && block) {
      const renamed = blockIdsOf(blocks, block).renamed;
      if (!renamed.has(id)) renamed.set(id, maxId);
    }
  });

  for (const [block, { kept, renamed }] of blocks) {
    if (renamed.size > 0) rewriteConnectorEnds(block, kept, renamed);
  }
  return changed;
}

interface BlockIds {
  /** 块内仍持有原编号的对象，指向这些编号的引用不能改。 */
  readonly kept: Set<number>;
  /** 块内被改号的对象：原编号 -> 新编号。 */
  readonly renamed: Map<number, number>;
}

function parseObjectId(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const id = Number(value);
  return id >= 1 && id <= MAX_OBJECT_ID ? id : undefined;
}

function blockIdsOf(blocks: Map<XmlNode, BlockIds>, block: XmlNode): BlockIds {
  let entry = blocks.get(block);
  if (!entry) {
    entry = { kept: new Set(), renamed: new Map() };
    blocks.set(block, entry);
  }
  return entry;
}

/** 对象所在的整块：`p:spTree` 的直接子节点（形状、组、连接线或包着它们的 `mc:AlternateContent`）。 */
function blockOf(element: XmlElement): XmlNode | undefined {
  let node: XmlNode | null = element;
  while (node?.parentNode) {
    const parent: XmlNode = node.parentNode;
    if (parent.namespaceURI === PML_NS && parent.localName === 'spTree') return node;
    node = parent;
  }
  return undefined;
}

function isInsideFallback(element: XmlElement): boolean {
  for (let node = element.parentNode; node; node = node.parentNode) {
    if (node.namespaceURI === MC_NS && node.localName === 'Fallback') return true;
  }
  return false;
}

function rewriteConnectorEnds(
  block: XmlNode,
  kept: ReadonlySet<number>,
  renamed: ReadonlyMap<number, number>,
): void {
  if (block.nodeType !== 1) return;
  for (const tag of ['stCxn', 'endCxn']) {
    for (const end of Array.from((block as XmlElement).getElementsByTagNameNS(DML_NS, tag)) as XmlElement[]) {
      const target = parseObjectId(end.getAttribute('id'));
      if (target === undefined || kept.has(target)) continue;
      const next = renamed.get(target);
      if (next !== undefined) end.setAttribute('id', String(next));
    }
  }
}
