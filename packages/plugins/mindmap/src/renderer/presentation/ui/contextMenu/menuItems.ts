/**
 * @file MindMap 右键菜单：菜单项构建（纯函数）
 *
 * 中文说明：
 * - 该模块只负责根据当前节点状态构建菜单项，不包含任何 UI/Store/DOM 副作用；
 * - 从 `MindMapContextMenu.vue` 拆分出来，降低 SFC 体积与耦合。
 */

import {
  NODE_KIND,
  TAGGING_STATUS,
  TAGGING_CONFIDENCE_LEVEL,
  canSetConfidenceForKind,
  canSetStatusForKind,
  type NodeKind,
  type TaggingConfidenceValue,
  type TaggingStatusValue,
} from '../../../domain/tagging/taggingRules'

import type { MenuItem } from './types'
import { AiIcon } from '@linnya/renderer-ui/icons'

function buildNodeKindChildren(kind: NodeKind | null): MenuItem[] {
  return [
    {
      text: kind === NODE_KIND.HYPOTHESIS ? '✓ 假设' : '假设',
      value: 'set_kind_hypothesis',
    },
    {
      text: kind === NODE_KIND.QUESTION ? '✓ 子问题' : '子问题',
      value: 'set_kind_question',
    },
    {
      text: kind === NODE_KIND.CONCLUSION ? '✓ 结论' : '结论',
      value: 'set_kind_conclusion',
    },
    { isSeparator: true },
    {
      text: '清除类型',
      value: 'clear_kind',
      disabled: !kind,
    },
  ]
}

function buildNodeStatusChildren(status: TaggingStatusValue | null): MenuItem[] {
  return [
    {
      text: status === TAGGING_STATUS.OPEN ? '✓ 未验证' : '未验证',
      value: 'set_status_open',
    },
    {
      text: status === TAGGING_STATUS.VERIFIED ? '✓ 已证实' : '已证实',
      value: 'set_status_verified',
    },
    {
      text: status === TAGGING_STATUS.REFUTED ? '✓ 已证伪' : '已证伪',
      value: 'set_status_refuted',
    },
    {
      text: status === TAGGING_STATUS.CLOSED ? '✓ 已关闭' : '已关闭',
      value: 'set_status_closed',
    },
    { isSeparator: true },
    {
      text: '清除状态',
      value: 'clear_status',
      disabled: !status,
    },
  ]
}

function buildNodeConfidenceChildren(
  confidence: TaggingConfidenceValue | null
): MenuItem[] {
  return [
    {
      text:
        confidence === TAGGING_CONFIDENCE_LEVEL.HIGH ? '✓ 高置信度' : '高置信度',
      value: 'set_confidence_high',
    },
    {
      text:
        confidence === TAGGING_CONFIDENCE_LEVEL.MEDIUM
          ? '✓ 中置信度'
          : '中置信度',
      value: 'set_confidence_medium',
    },
    {
      text:
        confidence === TAGGING_CONFIDENCE_LEVEL.LOW ? '✓ 低置信度' : '低置信度',
      value: 'set_confidence_low',
    },
    { isSeparator: true },
    {
      text: '清除置信度',
      value: 'clear_confidence',
      disabled: confidence === null || confidence === undefined,
    },
  ]
}

function buildAiTaskItems(kind: NodeKind | null): MenuItem[] {
  if (kind === NODE_KIND.QUESTION) {
    return [
      // 中文说明：AI 运行入口统一在右侧展示 AI 图标，明确该操作会启动模型执行。
      { text: '拆解问题', value: 'decompose_question', rightIconComponent: AiIcon },
      { text: '提出假设', value: 'propose_hypothesis', rightIconComponent: AiIcon },
    ]
  }
  if (kind === NODE_KIND.HYPOTHESIS) {
    return [
      { text: '验证假设', value: 'validate_hypothesis', rightIconComponent: AiIcon },
      { text: '提出假设', value: 'propose_hypothesis', rightIconComponent: AiIcon },
    ]
  }
  return []
}

export function buildMindMapContextMenuItems(params: {
  currentNodeKind: NodeKind | null
  currentNodeStatus: TaggingStatusValue | null
  currentNodeConfidence: TaggingConfidenceValue | null
  addEvidenceDisabled: boolean
  isRootNode: boolean
}): MenuItem[] {
  const { currentNodeKind, currentNodeStatus, currentNodeConfidence } = params

  const canSetStatus = canSetStatusForKind(currentNodeKind ?? undefined)
  const canSetConfidence = canSetConfidenceForKind(currentNodeKind ?? undefined)

  const deepAnalysisItem: MenuItem = {
    text: '深度分析',
    value: 'deep_analysis',
    rightIconComponent: AiIcon,
  }

  const items: MenuItem[] = [
    {
      text: '新增子主题',
      value: 'add_child',
      shortcut: 'Tab',
    },
    {
      text: '添加引用',
      value: 'add_evidence',
      disabled: params.addEvidenceDisabled,
    },
    ...(params.isRootNode ? [deepAnalysisItem] : []),
    ...buildAiTaskItems(currentNodeKind),
    { isSeparator: true },
    { isGroup: true, label: '推理标签' },
    {
      text: '节点类型',
      value: 'set_kind_hypothesis', // 作为默认值，实际由 children 处理
      children: buildNodeKindChildren(currentNodeKind),
    },
  ]

  if (canSetStatus) {
    items.push({
      text: '状态',
      value: 'set_status_open',
      children: buildNodeStatusChildren(currentNodeStatus),
    })
  }

  if (canSetConfidence) {
    items.push({
      text: '置信度',
      value: 'set_confidence_high',
      children: buildNodeConfidenceChildren(currentNodeConfidence),
    })
  }

  items.push(
    { isSeparator: true },
    {
      text: '删除主题',
      value: 'remove_node',
      shortcut: 'Delete',
      disabled: params.isRootNode,
      variant: 'danger',
    }
  )

  return items
}
