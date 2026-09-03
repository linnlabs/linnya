/**
 * @file MindMap 右键菜单：AI 运行发起链路（拆分自 MindMapContextMenu.vue）
 *
 * 中文说明：
 * - 目标：让 `MindMapContextMenu.vue` 只保留 UI 与菜单交互，避免把对话运行编排细节塞进组件里；
 * - 该模块负责：
 *   1) 构建用户可读的 run 头文案（不暴露 nodeId 等内部字段）
 *   2) 构建隐藏上下文（context_before）把 node_id 等信息传给 AI
 *   3) 构建 MindMap NodeRef View 作为 document_fragment
 *   4) 通过渲染端 AI port 发起历史隔离运行
 *
 * 设计约束：
 * - 不使用 any 类型断言；
 * - 插件扩展必须进入带 namespace 的 messageExtension，不能把私有字段平铺到核心 metadata。
 */

import { requireRendererAiInvocationPort } from '@plugin/renderer/aiInvocationPort'

import { useMindMapStore } from '../../../domain/store/mindmapStore'
import {
  buildMindMapChatDocumentFragmentFromStore,
  DEFAULT_MINDMAP_CHAT_CONTEXT_OPTIONS,
} from '../../../utils/mindmapAiContext'
import { MindmapPromptKeys, type MindmapPromptKey } from '@plugin/mindmap/shared'

export type MindMapAiAction =
  | 'deep_analysis'
  | 'decompose_question'
  | 'validate_hypothesis'
  | 'propose_hypothesis'

/** 将 MindMap 菜单动作映射到插件自带的 PromptKey */
function getActivityFeatureForAction(action: MindMapAiAction): MindmapPromptKey {
  switch (action) {
    case 'deep_analysis':
      return MindmapPromptKeys.MINDMAP_WORKFLOW_LEADER
    case 'decompose_question':
      return MindmapPromptKeys.MINDMAP_DECOMPOSE_QUESTION
    case 'validate_hypothesis':
      return MindmapPromptKeys.MINDMAP_VALIDATE_HYPOTHESIS
    case 'propose_hypothesis':
      return MindmapPromptKeys.MINDMAP_PROPOSE_HYPOTHESIS
  }
}

function buildRunPrompt(params: {
  action: MindMapAiAction
  nodeId: string
  nodeTopic: string
}): string {
  // 中文说明：action → 文案统一收口，避免散落在多处 if/else
  const actionLabelMap: Record<MindMapAiAction, string> = {
    deep_analysis: '深度分析',
    decompose_question: '拆解问题',
    validate_hypothesis: '验证假设',
    propose_hypothesis: '提出假设',
  }
  const actionLabel = actionLabelMap[params.action]

  /**
   * 中文说明（交互优化）：
   * - 这是 run 头的用户可见文案，会被落库并出现在后续对话历史中；
   * - 不应暴露 nodeId 等内部字段给用户（影响可读性）；
   * - 多余的定位信息通过 invokeAssistant 的 `options.context.contextBefore` 隐式传递给 AI。
   */
  return `${actionLabel}：${params.nodeTopic}`
}

/**
 * 构建 MindMap AI 运行的隐藏上下文（传给 AI，但不展示在用户气泡中）
 *
 * 中文说明：
 * - 该内容会进入后端的 `context_before`（不进入用户消息正文），用于帮助 Agent 稳定定位目标节点；
 * - 采用简单的 key=value 结构，便于后端排查与模型阅读；
 * - 字段名使用 snake_case，避免与事件库 metadata 口径冲突。
 */
function buildMindMapRunContextBefore(params: {
  action: MindMapAiAction
  nodeId: string
  nodeTopic: string
  documentId?: string
  documentTitle?: string
}): string {
  const lines: string[] = [
    '[MindMapRun]',
    `action=${params.action}`,
    `node_id=${params.nodeId}`,
    `node_topic=${params.nodeTopic}`,
    // 中文说明：为 Workflow Leader 等父编排 agent 提供统一锚点字段（兼容 prompt 中的示例格式）
    `target_node=nodeId=${params.nodeId}`,
  ]

  if (typeof params.documentId === 'string' && params.documentId.trim().length > 0) {
    lines.push(`document_id=${params.documentId}`)
  }
  if (typeof params.documentTitle === 'string' && params.documentTitle.trim().length > 0) {
    lines.push(`document_title=${params.documentTitle}`)
  }

  return lines.join('\n')
}

/**
 * 右键菜单发起 MindMap AI 历史隔离运行
 */
export async function startMindMapAiRun(params: {
  action: MindMapAiAction
  nodeId: string
  nodeTopic: string
}): Promise<void> {
  const aiInvocationPort = requireRendererAiInvocationPort()
  const mindmapStore = useMindMapStore()

  // 3) 创建 run header（用户气泡）并写入 activity 归属元数据
  const feature = getActivityFeatureForAction(params.action)
  // 中文说明：这里让 activity.feature 与 promptKey 保持一致，便于排查与后续统计。
  const promptKey = feature
  const prompt = buildRunPrompt(params)

  // MindMap 文档元信息（可能为空）
  const documentId = mindmapStore.currentDocumentId ?? undefined
  const documentTitle = mindmapStore.currentDocumentName ?? undefined

  const contextBefore = buildMindMapRunContextBefore({
    action: params.action,
    nodeId: params.nodeId,
    nodeTopic: params.nodeTopic,
    documentId,
    documentTitle,
  })

  // 5) 构建 MindMap NodeRef View（document_fragment），作为本次运行的独立上下文。
  const fragment = await buildMindMapChatDocumentFragmentFromStore(
    {
      kind: 'mindmap',
      ...(documentId
        ? {
            document: {
              id: documentId,
              title: documentTitle,
            },
          }
        : {}),
      selection: { selectedNodeIds: [params.nodeId] },
    },
    DEFAULT_MINDMAP_CHAT_CONTEXT_OPTIONS
  )

  await aiInvocationPort.startHistoryIsolatedRun({
    prompt,
    promptKey,
    activityFeature: feature,
    // ✅ 隐式上下文：把 nodeId/topic 等定位信息传给 AI（不污染用户可见文案）
    contextBefore,
    // ✅ 注入 MindMap 文档锚点（便于工具按 document_id 读取/写入）
    ...(documentId
      ? {
          documentMetadata: {
            id: documentId,
            title: documentTitle,
          },
        }
      : {}),
    ...(fragment ? { documentFragment: fragment } : {}),
    missingProjectMessage: '无法启动 AI 运行：当前未绑定项目（缺少 projectId）。',
    messageExtension: {
      namespace: 'mindmap.run',
      // 中文说明：仅用于前端调试/回放排查，不参与 UI 文案展示。
      data: {
        action: params.action,
        node_id: params.nodeId,
        node_topic: params.nodeTopic,
        ...(documentId ? { document_id: documentId } : {}),
        ...(documentTitle ? { document_title: documentTitle } : {}),
      },
    },
  })
}
