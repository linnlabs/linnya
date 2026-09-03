/**
 * @file reviewAnnotationCreator.ts
 * @description 审阅完成后，随机在文档块中创建批注的工具函数
 *
 * ⚠️ 说明：
 * - 该文件是 Review 早期 mock/过渡态实现的遗留产物
 * - 新版 Review：批注由后端工具（markdown_create_annotations）落库，前端仅展示 annotations
 * - 为避免历史代码破坏编译，这里保留为“仅供调试”的工具，但不再由主流程引用
 */

import { startCreatingAnnotation, confirmCreatingAnnotation } from '../../Annotation';
import { generatePrefixedId } from '../../../../../shared/utils/idUtils';
import type { Editor } from '@tiptap/core';

/**
 * mock 审阅消息结构（仅供本文件内部使用）
 */
export interface ReviewMessage {
  id: string;
  agentId: string;
  agentName: string;
  blockId: string;
  content: string;
  category?: string;
  createdAt: string;
  annotationId?: string;
}

/**
 * 从编辑器中获取所有可批注的块 ID
 * @param editor - Tiptap 编辑器实例
 * @returns 块 ID 数组
 */
export function getAllBlockIds(editor: Editor): string[] {
  if (!editor || !editor.state) return [];

  const blockIds: string[] = [];
  const doc = editor.state.doc;

  doc.descendants((node: { type?: { name?: string }; attrs?: Record<string, unknown> }) => {
    // 查找所有 rootBlock 类型的节点
    if (node.type?.name === 'rootBlock') {
      const id = node.attrs?.id;
      if (typeof id === 'string' && id.length > 0) {
        blockIds.push(id);
      }
    }
  });

  return blockIds;
}

/**
 * 生成模拟的审阅消息
 * @param agentId - 角色ID
 * @param agentName - 角色名称
 * @param blockIds - 可用的块ID数组
 * @param count - 要生成的消息数量
 * @returns 审阅消息数组
 */
export function generateMockReviewMessages(
  agentId: string,
  agentName: string,
  blockIds: string[],
  count: number
): ReviewMessage[] {
  if (blockIds.length === 0) return [];

  const mockComments = [
    { content: '这段内容的逻辑推理存在跳跃，建议补充中间论证步骤。', category: '逻辑' },
    { content: '此处的表述可以更简洁，避免冗余。', category: '修辞' },
    { content: '建议将这部分内容移到前面，以提高可读性。', category: '结构' },
    { content: '这里的论据不够充分，需要更多支撑材料。', category: '逻辑' },
    { content: '用词过于口语化，建议使用更正式的表达。', category: '修辞' },
    { content: '这个段落主题不够明确，建议添加主题句。', category: '结构' },
    { content: '前后观点存在矛盾，需要统一立场。', category: '逻辑' },
    { content: '句式过于单一，建议增加变化以提升节奏感。', category: '修辞' },
  ];

  const messages: ReviewMessage[] = [];
  const usedBlockIds = new Set<string>();

  for (let i = 0; i < Math.min(count, blockIds.length); i++) {
    // 随机选择一个未使用的块
    let randomBlockId: string;
    do {
      randomBlockId = blockIds[Math.floor(Math.random() * blockIds.length)];
    } while (usedBlockIds.has(randomBlockId) && usedBlockIds.size < blockIds.length);

    usedBlockIds.add(randomBlockId);

    // 随机选择一条评论
    const randomComment = mockComments[Math.floor(Math.random() * mockComments.length)];

    messages.push({
      id: generatePrefixedId('review-msg'),
      agentId,
      agentName,
      blockId: randomBlockId,
      content: randomComment.content,
      category: randomComment.category,
      createdAt: new Date().toISOString(),
    });
  }

  return messages;
}

/**
 * 为审阅消息创建对应的批注
 * @param message - 审阅消息
 * @param annotationStore - 批注存储实例
 * @param panelPositionManager - 布局管理器实例
 * @returns 创建的批注 ID，失败返回 null
 */
export async function createAnnotationForReviewMessage(
  message: ReviewMessage,
  annotationStore: unknown,
  panelPositionManager: unknown
): Promise<string | null> {
  try {
    // 开始创建批注
    const annotationId = await startCreatingAnnotation({
      blockId: message.blockId,
      annotationStore,
      panelPositionManager,
      author: message.agentName,
    });

    if (!annotationId) {
      console.error(`[reviewAnnotationCreator] 创建批注失败: ${message.id}`);
      return null;
    }

    // 确认批注内容
    const confirmedId = await confirmCreatingAnnotation({
      blockId: message.blockId,
      content: message.content,
      annotationStore,
      panelPositionManager,
    });

    return confirmedId;
  } catch (error) {
    console.error(`[reviewAnnotationCreator] 创建批注时出错:`, error);
    return null;
  }
}

/**
 * 批量创建审阅批注
 * @param messages - 审阅消息数组
 * @param annotationStore - 批注存储实例
 * @param panelPositionManager - 布局管理器实例
 * @param onProgress - 进度回调
 * @returns 成功创建的批注 ID 映射（messageId -> annotationId）
 */
export async function createAnnotationsForReview(
  messages: ReviewMessage[],
  annotationStore: unknown,
  panelPositionManager: unknown,
  onProgress?: (current: number, total: number) => void
): Promise<Map<string, string>> {
  const annotationIdMap = new Map<string, string>();

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    if (onProgress) {
      onProgress(i + 1, messages.length);
    }

    const annotationId = await createAnnotationForReviewMessage(
      message,
      annotationStore,
      panelPositionManager
    );

    if (annotationId) {
      annotationIdMap.set(message.id, annotationId);
    }

    // 添加小延迟以避免UI卡顿
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return annotationIdMap;
}
