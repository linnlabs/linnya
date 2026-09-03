import type {
  DocumentTypeBackendCreateParams,
  DocumentTypeBackendDatabase,
  DocumentTypeBackendDuplicateParams,
  DocumentTypeBackendDuplicateResult,
  DocumentTypeBackendHook,
  DocumentTypeBackendReadDatabase,
  DocumentTypeBackendReadResult,
  DocumentTypeBackendToolReadParams,
  DocumentTypeBackendToolReadResult,
  DocumentTypeBackendWriteParams,
} from '@plugin/backend/documentTypeBackendHook';
import {
  buildDocumentView,
  sliceTextWindow,
  type DocumentViewMeta,
  type WorkspaceDocumentReadOutlineItem,
} from '@app/schemas';
import {
  MINDMAP_DOCUMENT_TYPE,
  MINDMAP_FILE_EXTENSION,
  countMindMapNodes,
  type MindMapData,
  normalizeMindmap,
  parseMindmapMarkdownOutline,
  serializeMindmapToMarkdownOutline,
} from '@plugin/mindmap/shared';
import { MindMapDocumentService } from './persistence/mindmap_document/services/mindmap_document.service';
import { buildMindMapNodeRefView } from './tools/mindmap/read/mindmapNodeRefViewBuilder';
import type { MindMapDocumentServicePort } from './ports/mindMapDocumentServicePort';
import { requireMindMapSqliteDatabase } from './persistence/ports/sqliteDatabasePort';
import { publishWorkspaceDocumentUpdated } from '@plugin/backend/workspaceRuntime';

const MAX_MINDMAP_NODES = 500;

interface MindMapContentRow {
  readonly id: string;
  readonly version_number: number;
  readonly content_json: string;
}

interface MindMapTotalRow {
  readonly total: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isMindMapContentRow(value: unknown): value is MindMapContentRow {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.version_number === 'number' &&
    typeof value.content_json === 'string';
}

function isMindMapTotalRow(value: unknown): value is MindMapTotalRow {
  return isRecord(value) &&
    typeof value.total === 'number';
}

type MindMapServiceParams =
  | DocumentTypeBackendCreateParams
  | DocumentTypeBackendDuplicateParams
  | DocumentTypeBackendWriteParams
  | DocumentTypeBackendToolReadParams;

function readDatabase(params: MindMapServiceParams) {
  const databaseService = params.context.databaseService;
  if (!databaseService) {
    throw new Error('Workspace database not available in tool context.');
  }
  return requireMindMapSqliteDatabase(databaseService.getDb(), 'document hook');
}

function getMindMapService(params: MindMapServiceParams): MindMapDocumentServicePort {
  const db = readDatabase(params);
  const workspaceService = params.context.workspaceService;
  if (!workspaceService) {
    throw new Error('Workspace service not available in tool context.');
  }
  return new MindMapDocumentService(db, workspaceService, {
    publishDocumentUpdated: publishWorkspaceDocumentUpdated,
  });
}

function buildMindMapContent(content: string, fileName: string) {
  const rawMindMap = parseMindmapMarkdownOutline(content, fileName);
  const mindMap = normalizeMindmap(rawMindMap, fileName);
  const nodeCount = countMindMapNodes(mindMap.nodeData);
  if (nodeCount > MAX_MINDMAP_NODES) {
    throw new Error(`MindMap too large (${nodeCount} nodes). Please simplify and retry.`);
  }
  return mindMap;
}

function readLatestMindMapContentRow(
  db: DocumentTypeBackendReadDatabase,
  nodeId: string
): MindMapContentRow | null {
  const row = db.prepare(`
    SELECT id, version_number, content_json
    FROM mindmap_versions
    WHERE node_id = ?
    ORDER BY version_number DESC
    LIMIT 1
  `).get(nodeId);
  if (row === undefined) return null;
  if (!isMindMapContentRow(row)) {
    throw new Error(`MindMap 版本记录结构异常：${nodeId}`);
  }
  return row;
}

function readMindMapProjectCharCount(db: DocumentTypeBackendDatabase, projectId: string): number {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(v.char_count), 0) AS total
    FROM mindmap_versions v
    JOIN (
      SELECT node_id, MAX(version_number) AS max_ver
      FROM mindmap_versions
      GROUP BY node_id
    ) latest
      ON latest.node_id = v.node_id AND latest.max_ver = v.version_number
    JOIN workspace_nodes wn
      ON wn.id = v.node_id
    WHERE
      wn.project_id = ?
      AND wn.deleted_at IS NULL
      AND wn.type = 'mindmap'
  `).get(projectId);
  if (row === undefined) return 0;
  if (!isMindMapTotalRow(row)) {
    throw new Error(`MindMap 字符统计结果结构异常：${projectId}`);
  }
  return row.total;
}

function buildMindMapToolDocumentView(
  observationText: string,
  params: DocumentTypeBackendToolReadParams
): {
  documentViewText: string;
  totalTextLength: number;
  truncatedByChars: boolean;
  nextOffset: number | null;
} {
  const windowResult = sliceTextWindow(observationText, params.offsetChars, params.maxChars, true);
  const meta: DocumentViewMeta = {
    documentId: params.documentId,
    docType: MINDMAP_DOCUMENT_TYPE,
    offsetChars: params.offsetChars,
    truncatedByChars: windowResult.truncated,
    totalTextLength: windowResult.totalLength,
    nextOffset: windowResult.nextOffset,
  };

  return {
    documentViewText: buildDocumentView(meta, windowResult.text),
    totalTextLength: windowResult.totalLength,
    truncatedByChars: windowResult.truncated,
    nextOffset: windowResult.nextOffset,
  };
}

function buildMindMapStructureOnly(content: MindMapData): {
  text: string;
  uiOutline: WorkspaceDocumentReadOutlineItem[];
} {
  const root = content.nodeData;
  const uiOutline: WorkspaceDocumentReadOutlineItem[] = [];
  const lines: string[] = [];

  const walk = (node: Record<string, unknown>, depth: number): void => {
    const id = typeof node.id === 'string' ? node.id.trim() : '';
    const topic = typeof node.topic === 'string' ? node.topic.trim() : '';
    if (!id || !topic) {
      throw new Error('MindMap document contains a node without canonical id or topic');
    }
    const children = Array.isArray(node.children)
      ? node.children.filter(
          (child): child is Record<string, unknown> =>
            !!child && typeof child === 'object' && !Array.isArray(child)
        )
      : [];
    const hasChildren = children.length > 0;

    uiOutline.push({ id, depth, text: topic, hasChildren });
    lines.push(`${'  '.repeat(depth)}- ${topic}`);

    for (const child of children) {
      walk(child, depth + 1);
    }
  };

  walk(root, 0);

  return {
    text: lines.length > 0 ? lines.join('\n') : '（空思维导图）',
    uiOutline,
  };
}

function readMindMapDocument(params: DocumentTypeBackendToolReadParams): DocumentTypeBackendToolReadResult | null {
  const mindMapService = getMindMapService(params);
  const doc = mindMapService.getDocument(params.documentId);
  if (!doc) return null;

  if (params.structureOnly) {
    const outline = buildMindMapStructureOnly(doc.content);
    const window = sliceTextWindow(outline.text, params.offsetChars, params.maxChars, true);
    return {
      observation: window.text,
      data: {
        documentId: params.documentId,
        docType: MINDMAP_DOCUMENT_TYPE,
        truncatedByChars: window.truncated,
        totalTextLength: window.totalLength,
        nextOffset: window.nextOffset,
        documentName: params.documentName,
        presentation: { kind: 'outline', items: outline.uiOutline },
      },
    };
  }

  const nodeRefViewResult = buildMindMapNodeRefView(doc.content, params.documentId, doc.versionNumber, {
    uiMaxNodes: 600,
    uiMaxChars: params.maxChars,
  });
  const viewResult = buildMindMapToolDocumentView(nodeRefViewResult.observationText, params);
  return {
    observation: viewResult.documentViewText,
    data: {
      documentId: params.documentId,
      docType: MINDMAP_DOCUMENT_TYPE,
      truncatedByChars: viewResult.truncatedByChars,
      totalTextLength: viewResult.totalTextLength,
      nextOffset: viewResult.nextOffset,
      documentName: params.documentName,
      presentation: { kind: 'outline', items: nodeRefViewResult.uiOutline },
    },
  };
}

function duplicateMindMapDocument(
  params: DocumentTypeBackendDuplicateParams
): DocumentTypeBackendDuplicateResult | null {
  const mindMapService = getMindMapService(params);
  const source = mindMapService.getDocument(params.sourceDocumentId);
  if (!source) return null;
  const created = mindMapService.createDocument({
    projectId: params.projectId,
    parentId: params.parentId,
    name: params.name,
    content: source.content,
  });
  return { documentId: created.id };
}

export const mindmapDocumentTypeBackendHook: DocumentTypeBackendHook = {
  docType: MINDMAP_DOCUMENT_TYPE,
  displayName: 'MindMap',
  fileExtension: MINDMAP_FILE_EXTENSION,
  systemView: {
    name: 'outline.md',
    viewKind: 'mindmap_outline',
  },
  createDocument(params) {
    const mindMapService = getMindMapService(params);
    const initialContent =
      typeof params.content === 'string' && params.content.trim().length > 0
        ? buildMindMapContent(params.content, params.name)
        : undefined;
    const node = mindMapService.createDocument({
      projectId: params.projectId,
      parentId: params.parentId,
      name: params.name,
      content: initialContent,
    });
    return { documentId: node.id };
  },
  writeDocument(params) {
    const mindMapService = getMindMapService(params);
    const current = mindMapService.getDocument(params.documentId);
    if (!current) {
      throw new Error(`MindMap 文档不存在：${params.documentId}`);
    }
    const result = mindMapService.updateDocument({
      documentId: params.documentId,
      content: buildMindMapContent(params.content, params.documentName),
      expectedBaseVersionNumber: current.versionNumber,
    });
    return { versionNumber: result.versionNumber };
  },
  duplicateDocument(params) {
    return duplicateMindMapDocument(params);
  },
  readDocument(params) {
    return readMindMapDocument(params);
  },
  readVfsContent(params): DocumentTypeBackendReadResult | null {
    const row = readLatestMindMapContentRow(params.db, params.nodeId);
    if (!row) return null;
    const content: unknown = JSON.parse(row.content_json);
    return {
      contentType: 'text/markdown',
      text: serializeMindmapToMarkdownOutline(content),
      metadata: { versionNumber: row.version_number, versionId: row.id },
    };
  },
  readProjectCharCount(params) {
    return readMindMapProjectCharCount(params.db, params.projectId);
  },
};
