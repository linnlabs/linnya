import type { DocumentTypeContribution } from './types';

const documentTypesByActiveType = new Map<string, DocumentTypeContribution>();
const activeTypeByNodeType = new Map<string, string>();
const activeTypeByCreateRequestType = new Map<string, string>();
const activeTypeByFileSessionType = new Map<string, string>();

function assertNonEmpty(value: string | undefined, field: string, activeDocumentType: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`[documentTypeRegistry] ${activeDocumentType || '(empty)'} 缺少 ${field}`);
  }
  return normalized;
}

function assertUnique(map: Map<string, string>, key: string, field: string, contribution: DocumentTypeContribution): void {
  const existing = map.get(key);
  if (existing && existing !== contribution.activeDocumentType) {
    throw new Error(
      `[documentTypeRegistry] ${field} 冲突: ${key} (${existing} / ${contribution.activeDocumentType})`,
    );
  }
}

function validateEntityReferences(contribution: DocumentTypeContribution): void {
  if (contribution.entityReferences.length === 0) {
    throw new Error(
      `[documentTypeRegistry] 文档类型必须声明可跨插件引用的实体: ${contribution.activeDocumentType}`,
    );
  }

  for (const entity of contribution.entityReferences) {
    if (!entity.kind.trim() || !entity.description.trim()) {
      throw new Error(`[documentTypeRegistry] entityReference 缺少 kind/description: ${contribution.activeDocumentType}`);
    }
    if (!entity.uriPattern.startsWith('linnya://')) {
      throw new Error(
        `[documentTypeRegistry] entityReference URI 必须使用 linnya:// 稳定协议: ${contribution.activeDocumentType}/${entity.kind}`,
      );
    }
  }
}

export function registerDocumentType(contribution: DocumentTypeContribution): void {
  const activeDocumentType = assertNonEmpty(
    contribution.activeDocumentType,
    'activeDocumentType',
    contribution.activeDocumentType,
  );
  assertNonEmpty(contribution.nodeType, 'nodeType', activeDocumentType);
  assertNonEmpty(contribution.createRequestType, 'createRequestType', activeDocumentType);
  if (contribution.createBackend !== 'workspace-document' && contribution.createBackend !== 'plugin-document') {
    throw new Error(`[documentTypeRegistry] createBackend 非法: ${activeDocumentType}`);
  }
  if (contribution.createBackend === 'plugin-document') {
    assertNonEmpty(contribution.createHandlerId, 'createHandlerId', activeDocumentType);
  }
  assertNonEmpty(contribution.pluginId, 'pluginId', activeDocumentType);
  assertNonEmpty(contribution.label, 'label', activeDocumentType);
  assertNonEmpty(contribution.createLabel, 'createLabel', activeDocumentType);
  assertNonEmpty(contribution.defaultName, 'defaultName', activeDocumentType);
  validateEntityReferences(contribution);

  if (documentTypesByActiveType.has(activeDocumentType)) {
    throw new Error(`[documentTypeRegistry] activeDocumentType 冲突: ${activeDocumentType}`);
  }

  assertUnique(activeTypeByNodeType, contribution.nodeType, 'nodeType', contribution);
  assertUnique(activeTypeByCreateRequestType, contribution.createRequestType, 'createRequestType', contribution);
  if (contribution.fileSessionType) {
    assertUnique(activeTypeByFileSessionType, contribution.fileSessionType, 'fileSessionType', contribution);
  }

  documentTypesByActiveType.set(activeDocumentType, contribution);
  activeTypeByNodeType.set(contribution.nodeType, activeDocumentType);
  activeTypeByCreateRequestType.set(contribution.createRequestType, activeDocumentType);
  if (contribution.fileSessionType) {
    activeTypeByFileSessionType.set(contribution.fileSessionType, activeDocumentType);
  }
}

export function unregisterDocumentType(
  activeDocumentType: string,
  expectedContribution?: DocumentTypeContribution,
): boolean {
  const current = documentTypesByActiveType.get(activeDocumentType);
  if (!current) {
    return false;
  }
  if (expectedContribution && current !== expectedContribution) {
    return false;
  }

  documentTypesByActiveType.delete(activeDocumentType);
  if (activeTypeByNodeType.get(current.nodeType) === activeDocumentType) {
    activeTypeByNodeType.delete(current.nodeType);
  }
  if (activeTypeByCreateRequestType.get(current.createRequestType) === activeDocumentType) {
    activeTypeByCreateRequestType.delete(current.createRequestType);
  }
  if (
    current.fileSessionType &&
    activeTypeByFileSessionType.get(current.fileSessionType) === activeDocumentType
  ) {
    activeTypeByFileSessionType.delete(current.fileSessionType);
  }
  return true;
}

export function getRegisteredDocumentTypeByActiveType(
  activeDocumentType: string,
): DocumentTypeContribution | null {
  return documentTypesByActiveType.get(activeDocumentType) ?? null;
}

export function getRegisteredDocumentTypeByNodeType(nodeType: string): DocumentTypeContribution | null {
  const activeDocumentType = activeTypeByNodeType.get(nodeType);
  return activeDocumentType ? getRegisteredDocumentTypeByActiveType(activeDocumentType) : null;
}

export function getRegisteredDocumentTypeByCreateRequestType(
  createRequestType: string,
): DocumentTypeContribution | null {
  const activeDocumentType = activeTypeByCreateRequestType.get(createRequestType);
  return activeDocumentType ? getRegisteredDocumentTypeByActiveType(activeDocumentType) : null;
}

export function getRegisteredDocumentTypeByFileSessionType(
  fileSessionType: string,
): DocumentTypeContribution | null {
  const activeDocumentType = activeTypeByFileSessionType.get(fileSessionType);
  return activeDocumentType ? getRegisteredDocumentTypeByActiveType(activeDocumentType) : null;
}

export function listRegisteredDocumentTypes(): readonly DocumentTypeContribution[] {
  return Array.from(documentTypesByActiveType.values())
    .sort((a, b) => a.createPriority - b.createPriority || a.label.localeCompare(b.label));
}

export function clearRegisteredDocumentTypesForTest(): void {
  documentTypesByActiveType.clear();
  activeTypeByNodeType.clear();
  activeTypeByCreateRequestType.clear();
  activeTypeByFileSessionType.clear();
}
