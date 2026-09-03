/**
 * @file src/tools/knowledgebase/reader/ListKnowledgeBaseTool.ts
 *
 * @brief 列出当前项目可访问的知识库及其文档的工具
 *
 * @description
 * 在项目作用域下：
 * - 列出当前项目关联的知识库（kbId + 名称/描述/标签）
 * - 列出这些知识库下的已完成文档（docId + 标题）
 * 这是探索知识库的起点。
 */

import { BaseTool, ToolParameterSchema, ToolContext } from '../../types';
import {
  ListKnowledgeBaseArgsSchema,
  ListKnowledgeBaseResultSchema,
} from '@app/schemas';
import { Document } from '../../../features/knowledge-base/domain/document';
import {
  resolveKnowledgeBaseScopeFromContext,
  assertKbAllowedInScope
} from '../scope/projectKnowledgeBaseScope';

/**
 * 知识库摘要信息（仅用于工具输出，避免把领域模型完整透传到前端/模型）
 */
interface KnowledgeBaseSummary {
  /** 知识库ID */
  id: string;
  /** 知识库名称 */
  name: string;
  /** 知识库描述 */
  description?: string | null;
  /** 标签 */
  tags?: string[];
}

/**
 * 文档摘要信息（工具输出）
 */
interface DocumentSummary {
  id: string;
  title: string;
  /** 该文档所属知识库ID，方便模型做进一步选择 */
  kb_id: string;
  /** 该文档所属知识库名称（若可用） */
  kb_name?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isDocumentSummary(value: unknown): value is DocumentSummary {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.title) &&
    isString(value.kb_id) &&
    (value.kb_name === undefined || value.kb_name === null || isString(value.kb_name))
  );
}

/**
 * 列出所有可用文档的工具类
 * 提供知识库中所有可用文档的列表
 */
export class ListKnowledgeBaseTool extends BaseTool {
  /**
   * 说明：
   * - 为了让模型在“项目作用域”下明确知道可访问哪些知识库，本工具会同时返回：
   *   1) 当前项目关联的知识库列表（kbId + 名称/描述/标签）
   *   2) 这些知识库下的已完成文档列表
   * - 工具名改为更符合语义的 `list_knowledge_base`（不新增工具数量）。
   */
  readonly name = 'list_knowledge_base';
  
  get description() {
    return `Lists all documents currently available in the knowledge base, providing both their title and unique ID.

# When to Use
- When the user asks a general question like "What files do you have?" or "What can you tell me about?".
- As a first step when you have no other information to start a search.
- To know what documents are available in the knowledge base, so you can choose documents for reading or searching later.

# Strategy
- Use the output of this tool to get a \`doc_id\` that you can then use with \`knowledge_search\` or \`knowledge_read\`.`;
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      kb_id: {
        type: 'string',
        description:
          '可选。指定要列出文档的知识库ID。若不传，则默认列出“当前项目关联的所有知识库”下的文档。'
      }
    }
  };

  getExecutionSummary(output: string): string {
    try {
      const parsedUnknown: unknown = JSON.parse(output);
      if (!isRecord(parsedUnknown)) return '无法解析文档列表结果。';
      const dataUnknown = parsedUnknown.data;
      if (!isRecord(dataUnknown)) return '无法解析文档列表结果。';

      const documentsUnknown = dataUnknown.documents;
      const kbsUnknown = dataUnknown.knowledge_bases;

      const documents = Array.isArray(documentsUnknown)
        ? documentsUnknown.filter(isDocumentSummary)
        : [];

      const kbCount =
        Array.isArray(kbsUnknown) && kbsUnknown.every(isRecord) ? kbsUnknown.length : 0;

      if (documents.length === 0) {
        return kbCount > 0
          ? `当前项目关联 ${kbCount} 个知识库，但暂无已完成文档。`
          : '知识库中没有可用文件。';
      }

      const count = documents.length;
      const titles = documents.map((d) => d.title);
      const kbHint = kbCount > 0 ? `（关联知识库 ${kbCount} 个）` : '';

      if (count <= 5) {
        return `找到了 ${count} 个文件${kbHint}: "${titles.join('", "')}".`;
      }
      const someTitles = titles.slice(0, 5).join('", "');
      return `找到了 ${count} 个文件${kbHint}，包括: "${someTitles}" 等。`;
    } catch {
      return '无法解析文档列表结果。';
    }
  }

  async run(_args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const args = ListKnowledgeBaseArgsSchema.parse(_args);
    const { knowledgeBaseService } = context;

    if (!knowledgeBaseService) {
      throw new Error('Knowledge base service not available in context');
    }

    try {
      // 项目对话：默认限定到“当前项目关联的知识库”；非项目对话：回退到单一知识库
      const scope = resolveKnowledgeBaseScopeFromContext(context);

      const requestedKbId = args.kb_id ?? '';

      const kbIdsToList =
        requestedKbId.length > 0 ? [requestedKbId] : scope.kbIds;

      // 项目对话下，如果显式传了 kb_id，则必须属于该项目关联的知识库
      if (requestedKbId) {
        assertKbAllowedInScope(scope, requestedKbId);
      }

      // 1) 获取“当前项目可访问的知识库列表”，用于提示模型做选择（kbId + 名称/描述/标签）
      // 说明：这里只做“读取并过滤”，不引入跨层直接查表，保持工具层依赖 Application Service。
      const allKbs = await knowledgeBaseService.getAllKnowledgeBases();
      const kbIdToSummary = new Map<string, KnowledgeBaseSummary>();
      for (const kb of allKbs) {
        kbIdToSummary.set(kb.id, {
          id: kb.id,
          name: kb.name,
          description: kb.description,
          tags: Array.isArray(kb.tags) ? kb.tags : []
        });
      }

      const allowedKbIds = scope.kbIds;
      const allowedKnowledgeBases: KnowledgeBaseSummary[] = allowedKbIds.map((kbId) => {
        const found = kbIdToSummary.get(kbId);
        if (found) return found;
        // 数据真实状态：项目链接存在但知识库元数据不存在。这里用占位信息，便于排查。
        return {
          id: kbId,
          name: `未知知识库（${kbId}）`,
          description: null,
          tags: []
        };
      });

      // 调用知识库服务批量获取文档
      const allDocs: Document[] = [];
      for (const kbId of kbIdsToList) {
        const docs = await knowledgeBaseService.getDocumentsInKnowledgeBase(kbId);
        allDocs.push(...docs);
      }

      // 仅返回已完成处理的文档
      const formattedDocs: DocumentSummary[] = allDocs
        .filter((doc) => doc.status === 'completed')
        .map((doc) => {
          const kbName = kbIdToSummary.get(doc.kbId)?.name;
          return {
            id: doc.id,
            title: doc.filename,
            kb_id: doc.kbId,
            ...(kbName ? { kb_name: kbName } : {})
          };
        });

      // 2) 给模型的 observation：把知识库列表 + 文档列表用可读文本表达出来
      const kbLines = allowedKnowledgeBases.map((kb) => {
        const tagsText = Array.isArray(kb.tags) && kb.tags.length > 0 ? ` tags=${kb.tags.join(',')}` : '';
        const descText = typeof kb.description === 'string' && kb.description.trim().length > 0
          ? ` - ${kb.description.trim()}`
          : '';
        return `- ${kb.name} (kb_id=${kb.id})${tagsText}${descText}`;
      });

      const docLines = formattedDocs.map((doc) => {
        const kbNameText = doc.kb_name ? ` / ${doc.kb_name}` : '';
        return `- ${doc.title} (doc_id=${doc.id}, kb_id=${doc.kb_id}${kbNameText})`;
      });

      const observationParts: string[] = [];
      observationParts.push(`当前项目(project_id=${scope.projectId})可访问的知识库如下：\n${kbLines.join('\n')}`);
      if (requestedKbId) {
        observationParts.push(`\n本次仅列出指定知识库(kb_id=${requestedKbId})下的已完成文档：`);
      } else {
        observationParts.push(`\n本次列出上述知识库下的已完成文档：`);
      }
      observationParts.push(docLines.length > 0 ? docLines.join('\n') : '- （无已完成文档）');
      
      const result = ListKnowledgeBaseResultSchema.parse({
        data: {
          project_id: scope.projectId,
          knowledge_bases: allowedKnowledgeBases,
          documents: formattedDocs,
          ...(requestedKbId ? { requested_kb_id: requestedKbId } : {})
        },
        observation: observationParts.join('\n')
      });
      // 轻量化：不 pretty-print，降低 tool_output 体积
      return JSON.stringify(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to list documents: ${errorMsg}`);
    }
  }
}
