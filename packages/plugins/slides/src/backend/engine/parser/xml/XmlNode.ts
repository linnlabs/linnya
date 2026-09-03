/**
 * XmlNode
 *
 * OOXML DOM 通用工具：基于 @xmldom/xmldom，封装 PptxReader 全链路用到的高频访问操作。
 * 这些函数都是纯函数，不持有任何上下文，可以在子模块间自由复用。
 */

import type { Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom';

/** 取所有匹配 `tagName` 的子节点（含后代）。 */
export function getElements(parent: XmlElement | XmlDocument, tagName: string): XmlElement[] {
  const result: XmlElement[] = [];
  const nodes = parent.getElementsByTagName(tagName);
  for (let i = 0; i < nodes.length; i++) {
    result.push(nodes.item(i) as XmlElement);
  }
  return result;
}

/** 取第一个匹配 `tagName` 的子节点（含后代）。 */
export function getElementByTag(
  parent: XmlElement | XmlDocument,
  tagName: string,
): XmlElement | null {
  const nodes = parent.getElementsByTagName(tagName);
  return nodes.length > 0 ? (nodes.item(0) as XmlElement) : null;
}

/** namespace prefix 可能被 Office 改写时，按 localName 读取后代。 */
export function getElementsByLocalName(
  parent: XmlElement | XmlDocument,
  localName: string,
): XmlElement[] {
  const result: XmlElement[] = [];
  const nodes = parent.getElementsByTagName('*');
  for (let index = 0; index < nodes.length; index++) {
    const element = nodes.item(index);
    if (
      element
      && (element.localName === localName || element.tagName.split(':').pop() === localName)
    ) {
      result.push(element);
    }
  }
  return result;
}

export function getElementByLocalName(
  parent: XmlElement | XmlDocument,
  localName: string,
): XmlElement | null {
  return getElementsByLocalName(parent, localName)[0] ?? null;
}

/** 取属性，避免 xmldom 在缺失时返回空字符串。 */
export function getAttr(el: XmlElement, attr: string): string | null {
  return el.hasAttribute(attr) ? el.getAttribute(attr) : null;
}

/** 拼接所有 `tagName` 节点下的文本内容。 */
export function getTextContent(parent: XmlElement, tagName: string): string {
  const parts: string[] = [];
  const nodes = parent.getElementsByTagName(tagName);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes.item(i);
    if (node?.textContent) parts.push(node.textContent);
  }
  return parts.join('');
}

/** OOXML 布尔值约定：`'1' | 'true'` ⇒ true，缺失 ⇒ undefined。 */
export function parseBooleanAttr(value: string | null): boolean | undefined {
  if (value == null) return undefined;
  return value === '1' || value.toLowerCase() === 'true';
}

/**
 * 仅取直接子节点（避免嵌套 group / 嵌套 paragraph 等场景中后代被重复枚举）。
 * 这是 PptxReader 内部多处 spTree / txBody 解析的核心工具。
 */
export function directChildren(parent: XmlElement, tagName: string): XmlElement[] {
  const result: XmlElement[] = [];
  const children = parent.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children.item(i);
    if (child && child.nodeType === 1 && (child as XmlElement).tagName === tagName) {
      result.push(child as XmlElement);
    }
  }
  return result;
}

/**
 * 从 `relsDoc` 构建 `relId → target` 映射。
 * relMap 在多处被用到（presentation / slide / master 三层 rels），统一放到通用工具里。
 */
export function buildRelMap(relsDoc: XmlDocument): Map<string, string> {
  const map = new Map<string, string>();
  const rels = getElements(relsDoc, 'Relationship');
  for (const rel of rels) {
    const id = getAttr(rel, 'Id');
    const target = getAttr(rel, 'Target');
    if (id && target) map.set(id, target);
  }
  return map;
}

/**
 * 从 `p:cNvPr/a:extLst/a:ext/a16:creationId` 中读出 PowerPoint 的稳定 creationId。
 * 用于 imported / patched 链路下保持元素 ID 跨次解析稳定。
 */
export function extractCreationId(cNvPr: XmlElement | null): string | null {
  if (!cNvPr) return null;
  const extLst = getElementByTag(cNvPr, 'a:extLst');
  if (!extLst) return null;
  const exts = getElements(extLst, 'a:ext');
  for (const ext of exts) {
    const creationId = getElementByTag(ext, 'a16:creationId');
    if (creationId) {
      return getAttr(creationId, 'id');
    }
  }
  return null;
}
