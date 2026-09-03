/**
 * @file addCurrentDocumentToKb.ts
 * @description 将当前文档添加到知识库的核心服务函数
 *
 * 设计说明（中文）：
 * - 职责单一：序列化当前编辑器内容 → 构造 File → 入队 → 触发解析
 * - 不依赖 UI：可被顶部 More 菜单、侧边栏 TreeItem More 菜单等多处复用
 * - 使用编辑器实时内容（包含未保存改动），符合用户直觉
 * - 文件名清洗规则与 batchExportService 保持一致，避免 Windows 非法字符问题
 */

import { createMarkdownSerializer } from '../../../shared/utils/markdownSerializer';
import type { Editor } from '@tiptap/core';
import type { KnowledgeBaseMessageResolver } from '../definitions/knowledgeBaseMessages';

/**
 * 知识库 Store 的最小接口（避免循环依赖，使用 duck typing）
 */
type KnowledgeBaseStoreLike = {
  ensureDataLoaded: () => Promise<void>;
  addFilesToQueue: (kbId: string, files: File[]) => void;
  startParsing: () => Promise<void>;
};

/**
 * 添加文档到知识库的参数
 */
export interface AddDocumentToKbParams {
  /** 目标知识库 ID */
  targetKbId: string;
  /** 文档名称（用于生成文件名） */
  documentName: string;
  /** Tiptap 编辑器实例 */
  editor: Editor;
  /** 知识库 Store 实例 */
  kbStore: KnowledgeBaseStoreLike;
  /** 用户可见文案解析器 */
  message: KnowledgeBaseMessageResolver;
}

/**
 * 添加文档到知识库的结果
 */
export type AddDocumentToKbResult =
  | {
      success: true;
      fileName: string;
    }
  | {
      success: false;
      error: string;
    };

/**
 * 文件名清洗：移除 Windows/macOS 非法字符，规避结尾点/空格
 *
 * 中文说明：
 * - 与 batchExportService.ts 的 sanitizeFileBaseName 保持一致
 * - 即使这里不落盘，也让语义一致，避免后端处理时出现意外
 */
function sanitizeFileBaseName(input: string): string {
  const trimmed = input.trim();
  const replaced = trimmed.replace(/[\\/:*?"<>|]/g, '_');
  const noTrailing = replaced.replace(/[.\s]+$/g, '');
  return noTrailing.length > 0 ? noTrailing : 'Untitled';
}

/**
 * 确保文件名以 .md 结尾
 */
function withMdExtension(baseName: string): string {
  const clean = baseName.replace(/\.[^/.]+$/u, '');
  return `${clean}.md`;
}

/**
 * 将当前编辑器内容序列化为 Markdown
 *
 * 中文说明：
 * - 使用 escapeSpecialChars: false，让向量库吃到"原始文本"
 * - 避免把 \[ \] 这类反斜杠带入语料，影响检索效果
 */
function serializeEditorToMarkdown(editor: Editor): string {
  const serializer = createMarkdownSerializer({ escapeSpecialChars: false });
  const doc = editor.state.doc;
  return serializer.serialize(doc);
}

/**
 * 将当前文档添加到指定知识库
 *
 * 中文说明：
 * - 核心流程：序列化 → 构造 File → 入队 → startParsing
 * - 不处理 UI 反馈（toast/弹窗），由调用方负责
 * - 不检查模型配置（现有上传逻辑会在执行时检查并报错）
 *
 * @param params 添加参数
 * @returns 添加结果
 */
export async function addCurrentDocumentToKb(
  params: AddDocumentToKbParams
): Promise<AddDocumentToKbResult> {
  const { targetKbId, documentName, editor, kbStore, message } = params;

  // 参数校验
  if (!targetKbId || typeof targetKbId !== 'string' || targetKbId.trim().length === 0) {
    return { success: false, error: message('knowledgeBase.addTo.error.targetRequired') };
  }

  if (!editor || !editor.state || !editor.state.doc) {
    return { success: false, error: message('knowledgeBase.addTo.error.editorUnavailable') };
  }

  try {
    // 1. 序列化编辑器内容为 Markdown
    const markdown = serializeEditorToMarkdown(editor);

    if (!markdown || markdown.trim().length === 0) {
      return { success: false, error: message('knowledgeBase.addTo.error.emptyDocument') };
    }

    // 2. 构造文件名
    const safeName = sanitizeFileBaseName(documentName || message('knowledgeBase.addTo.untitledDocument'));
    const fileName = withMdExtension(safeName);

    // 3. 构造 File 对象
    const file = new File([markdown], fileName, { type: 'text/markdown' });

    // 4. 确保知识库数据已加载（避免 store 未初始化）
    await kbStore.ensureDataLoaded();

    // 5. 添加到上传队列
    kbStore.addFilesToQueue(targetKbId, [file]);

    // 6. 触发解析（自动开始上传与后台解析任务）
    await kbStore.startParsing();

    return { success: true, fileName };
  } catch (error) {
    console.error('[addCurrentDocumentToKb] 添加文档到知识库失败:', error);
    return { success: false, error: message('knowledgeBase.addTo.error.unknown') };
  }
}
