/**
 * @file configs/common.ts
 * @description 杂项工具 UI 配置
 *
 * 包含：ask、generate_image、list_files/write_file/edit_file/grep、
 * assemble / evidence、sharedmemory、taskstate、todo、tool_output_read、subagent、subrun_batch
 */

import { defineAsyncComponent } from 'vue';
import type { ToolUiConfig } from '../types';
import { ImageIcon } from '@linnya/renderer-ui/icons';
import { ReadIcon } from '@linnya/renderer-ui/icons';
import { ListIcon } from '@linnya/renderer-ui/icons';
import { EditIcon } from '@linnya/renderer-ui/icons';
import { SearchIcon } from '@linnya/renderer-ui/icons';
import { projectTaskStatePresentation } from '../taskstate/functions/projectTaskStatePresentation';
import { projectAgentTodoPresentation } from '../todo/functions/projectAgentTodoPresentation';
import { projectToolOutputReadPresentation } from '../tool_output/functions/projectToolOutputReadPresentation';
import { projectConversationArtifactReadPresentation } from '../sharedmemory/functions/projectConversationArtifactReadPresentation';
import { projectSharedMemoryListPresentation } from '../sharedmemory/functions/projectSharedMemoryListPresentation';
import { projectSharedMemoryWritePresentation } from '../sharedmemory/functions/projectSharedMemoryWritePresentation';
import { projectWorkspaceListFilesPresentation } from '../workspace/functions/projectWorkspaceListFilesPresentation';
import { projectWorkspaceGrepPresentation } from '../workspace/functions/projectWorkspaceGrepPresentation';
import { projectWorkspaceWriteFilePresentation } from '../workspace/functions/projectWorkspaceWriteFilePresentation';
import { projectWorkspaceEditFilePresentation } from '../workspace/functions/projectWorkspaceEditFilePresentation';
import { projectSkillPresentation } from '../skill/functions/projectSkillPresentation';
import { projectImageGenerationPresentation } from '../image/functions/projectImageGenerationPresentation';
import { projectAskPresentation } from '../questionnaire/functions/projectAskPresentation';
import { projectEvidenceHeaderPresentation } from '../evidence/functions/projectEvidenceHeaderPresentation';
import { projectHistoricalAssembleEvidencePresentation } from '../evidence/functions/projectHistoricalAssembleEvidencePresentation';
import { projectImageReadPresentation } from '../image-read/functions/projectImageReadPresentation';
import { projectSingleSubrunPresentation } from '../../../features/subrun-card/functions/projectSingleSubrunPresentation';
import { projectSubrunBatchPresentation } from '../../../features/subrun-collection/functions/projectSubrunBatchPresentation';
import { createStaticToolCompactStepProjector } from '../compact-step/functions/createStaticToolCompactStepProjector';

const compactStep = {
  skill: createStaticToolCompactStepProjector('conversation.tool.skill.compact'),
  ask: createStaticToolCompactStepProjector('conversation.tool.askQuestions.compact'),
  image: createStaticToolCompactStepProjector('conversation.tool.imageGeneration.compact'),
  imageRead: createStaticToolCompactStepProjector('conversation.tool.imageRead.title'),
  listFiles: createStaticToolCompactStepProjector('conversation.tool.workspace.files.list'),
  writeFile: createStaticToolCompactStepProjector('conversation.tool.workspace.compact.write'),
  editFile: createStaticToolCompactStepProjector('conversation.tool.workspace.compact.edit'),
  grep: createStaticToolCompactStepProjector('conversation.tool.workspace.compact.grep'),
  assemble: createStaticToolCompactStepProjector('conversation.tool.evidence.assemble'),
  evidenceRead: createStaticToolCompactStepProjector('conversation.tool.evidence.read'),
  sharedMemoryList: createStaticToolCompactStepProjector('conversation.tool.sharedMemory.list'),
  sharedMemoryRead: createStaticToolCompactStepProjector('conversation.tool.sharedMemory.read'),
  sharedMemoryWrite: createStaticToolCompactStepProjector('conversation.tool.sharedMemory.write'),
  taskRead: createStaticToolCompactStepProjector('conversation.tool.taskState.read'),
  taskWrite: createStaticToolCompactStepProjector('conversation.tool.taskState.update'),
  todoRead: createStaticToolCompactStepProjector('conversation.tool.todo.read'),
  todoWrite: createStaticToolCompactStepProjector('conversation.tool.todo.update'),
  toolOutput: createStaticToolCompactStepProjector('conversation.tool.output.continue'),
  subrun: createStaticToolCompactStepProjector('conversation.tool.subrun.compact'),
  subrunBatch: createStaticToolCompactStepProjector('conversation.tool.subrun.batchCompact'),
} as const;

const ImageGenerationCard = defineAsyncComponent(() => import('../image/ImageGenerationCard.vue'));
const AskQuestionsCard = defineAsyncComponent(
  () => import('../questionnaire/QuestionnaireCard.vue')
);
const NoopToolContent = defineAsyncComponent(() => import('../NoopToolContent.vue'));
const SharedMemoryDocListCard = defineAsyncComponent(
  () => import('../sharedmemory/SharedMemoryDocListCard.vue')
);
const SharedMemoryDocReadCard = defineAsyncComponent(
  () => import('../sharedmemory/SharedMemoryDocReadCard.vue')
);
const SharedMemoryDocWriteCard = defineAsyncComponent(
  () => import('../sharedmemory/SharedMemoryDocWriteCard.vue')
);
const TaskStateCard = defineAsyncComponent(() => import('../taskstate/TaskStateCard.vue'));
const AgentTodoCard = defineAsyncComponent(() => import('../todo/AgentTodoCard.vue'));
const ToolOutputReadCard = defineAsyncComponent(
  () => import('../tool_output/ToolOutputReadCard.vue')
);
const SubrunProgressCard = defineAsyncComponent(
  async () => (await import('../../../features/subrun-card')).SubrunProgressCard
);
const SubrunCompactStepTitle = defineAsyncComponent(
  async () => (await import('../../../features/subrun-card')).SubrunCompactStepTitle
);
const SubrunBatchCollection = defineAsyncComponent(
  async () => (await import('../../../features/subrun-collection')).SubrunBatchCollection
);
const SkillLearnedCard = defineAsyncComponent(() => import('../skill/SkillLearnedCard.vue'));
const ImageReadCard = defineAsyncComponent(
  () => import('../image-read/ImageReadCard.vue'),
);

const subagentToolUiConfig: ToolUiConfig = {
  component: SubrunProgressCard,
  titleComponent: SubrunCompactStepTitle,
  icon: ListIcon,
  presentation: projectSingleSubrunPresentation,
  compactStep: compactStep.subrun,
  runtime: { subrunTrace: true },
  layout: {
    fullWidth: true,
    defaultCollapsed: true,
    // ToolCallsMessage 持有统一外壳与折叠；标题和正文复用同一套 compact-step 投影规则。
    // 全量 child messages 仍只在详情中展示。
  },
};

const askToolUiConfig: ToolUiConfig = {
  component: AskQuestionsCard,
  presentation: projectAskPresentation,
  compactStep: compactStep.ask,
  layout: {
    hideBorder: true,
    hideBackground: true,
    noPadding: true,
    fullWidth: true,
    overflowVisible: true,
  },
};

const imageGenerationToolUiConfig: ToolUiConfig = {
  component: ImageGenerationCard,
  presentation: projectImageGenerationPresentation,
  compactStep: compactStep.image,
  layout: {
    hideBorder: true,
    hideBackground: true,
    noPadding: true,
    fullWidth: true,
  },
};

export const commonToolConfigs: Record<string, ToolUiConfig> = {
  // ---------------------------------------------------------------------------
  // Skill（学习/加载技能）
  // ---------------------------------------------------------------------------
  'skill': {
    component: SkillLearnedCard,
    presentation: projectSkillPresentation,
    compactStep: compactStep.skill,
    layout: {
      // 说明：该卡片自身提供灰底与间距，这里只移除外层 tool-card 的阴影/背景
      hideBorder: true,
      hideBackground: true,
      noPadding: true,
      fullWidth: true,
    },
  },
  'skill_resource_read': {
    component: SkillLearnedCard,
    presentation: projectSkillPresentation,
    compactStep: compactStep.skill,
    layout: {
      // 说明：历史 Skill Resource 续读事件仍延续技能学习的轻量提示。
      hideBorder: true,
      hideBackground: true,
      noPadding: true,
      fullWidth: true,
    },
  },

  // ---------------------------------------------------------------------------
  // 问卷 & 图片
  // ---------------------------------------------------------------------------
  'ask': askToolUiConfig,
  // 历史事件名仅用于 replay 与可能仍在同一进程中的 wait-user 恢复。
  'ask_questions': askToolUiConfig,

  'generate_image': imageGenerationToolUiConfig,
  // 只读历史事件；backend 不再注册同名 executable tool。
  'text_to_image': imageGenerationToolUiConfig,

  'image_read': {
    component: ImageReadCard,
    icon: ImageIcon,
    presentation: projectImageReadPresentation,
    compactStep: compactStep.imageRead,
    runtime: { attachments: true },
    layout: {
      fullWidth: true,
      defaultCollapsed: true,
    },
  },

  // ---------------------------------------------------------------------------
  // Workspace Path 文件浏览、搜索、新建与编辑
  // ---------------------------------------------------------------------------
  'list_files': {
    component: NoopToolContent,
    icon: ListIcon,
    presentation: projectWorkspaceListFilesPresentation,
    compactStep: compactStep.listFiles,
    layout: { fullWidth: true, hideContent: true },
  },
  'write_file': {
    component: NoopToolContent,
    icon: EditIcon,
    presentation: projectWorkspaceWriteFilePresentation,
    compactStep: compactStep.writeFile,
    layout: { fullWidth: true, hideContent: true, disableHeaderHover: true },
  },
  'edit_file': {
    component: NoopToolContent,
    icon: EditIcon,
    presentation: projectWorkspaceEditFilePresentation,
    compactStep: compactStep.editFile,
    layout: { fullWidth: true, hideContent: true, disableHeaderHover: true },
  },
  'grep': {
    component: NoopToolContent,
    icon: SearchIcon,
    presentation: projectWorkspaceGrepPresentation,
    compactStep: compactStep.grep,
    layout: { fullWidth: true, hideContent: true, disableHeaderHover: true },
  },

  // ---------------------------------------------------------------------------
  // Assemble & Evidence
  // ---------------------------------------------------------------------------
  'assemble_evidence': {
    component: NoopToolContent,
    icon: ListIcon,
    // 只读历史事件；backend 不再注册同名 executable tool。
    presentation: projectHistoricalAssembleEvidencePresentation,
    compactStep: compactStep.assemble,
    layout: { fullWidth: true, hideContent: true },
  },
  'assemble_documents': {
    component: NoopToolContent,
    icon: ListIcon,
    presentation: projectEvidenceHeaderPresentation,
    compactStep: compactStep.assemble,
    layout: { fullWidth: true, hideContent: true },
  },
  'evidence_resolve': {
    component: NoopToolContent,
    icon: ReadIcon,
    presentation: projectEvidenceHeaderPresentation,
    compactStep: compactStep.evidenceRead,
    layout: { fullWidth: true, hideContent: true },
  },

  // ---------------------------------------------------------------------------
  // SharedMemory（历史 / Deep Research 内部产物回放）
  // ---------------------------------------------------------------------------
  'sharedmemory_list': {
    component: SharedMemoryDocListCard,
    icon: ListIcon,
    presentation: projectSharedMemoryListPresentation,
    compactStep: compactStep.sharedMemoryList,
    layout: { fullWidth: true, hideContent: true },
  },
  'sharedmemory_read': {
    component: SharedMemoryDocReadCard,
    icon: ReadIcon,
    presentation: projectConversationArtifactReadPresentation,
    compactStep: compactStep.sharedMemoryRead,
    layout: { fullWidth: true, hideContent: true },
  },
  'sharedmemory_write': {
    component: SharedMemoryDocWriteCard,
    icon: EditIcon,
    presentation: projectSharedMemoryWritePresentation,
    compactStep: compactStep.sharedMemoryWrite,
    layout: { fullWidth: true, hideContent: true },
  },

  // ---------------------------------------------------------------------------
  // TaskState
  // ---------------------------------------------------------------------------
  'task_read': {
    component: TaskStateCard,
    icon: ReadIcon,
    presentation: projectTaskStatePresentation,
    compactStep: compactStep.taskRead,
    layout: { fullWidth: true, defaultCollapsed: false },
  },
  'task_write': {
    component: TaskStateCard,
    icon: EditIcon,
    presentation: projectTaskStatePresentation,
    compactStep: compactStep.taskWrite,
    layout: { fullWidth: true, defaultCollapsed: false },
  },
  // 旧名称仅用于解释已经持久化的历史事件，不是 live ToolRegistry alias。
  'taskstate_read': {
    component: TaskStateCard,
    icon: ReadIcon,
    presentation: projectTaskStatePresentation,
    compactStep: compactStep.taskRead,
    layout: { fullWidth: true, defaultCollapsed: false },
  },
  'taskstate_write': {
    component: TaskStateCard,
    icon: EditIcon,
    presentation: projectTaskStatePresentation,
    compactStep: compactStep.taskWrite,
    layout: { fullWidth: true, defaultCollapsed: false },
  },

  // ---------------------------------------------------------------------------
  // Agent ToDo
  // ---------------------------------------------------------------------------
  'todo_read': {
    component: AgentTodoCard,
    icon: ListIcon,
    presentation: projectAgentTodoPresentation,
    compactStep: compactStep.todoRead,
    layout: { fullWidth: true, defaultCollapsed: true },
  },
  'todo_write': {
    component: AgentTodoCard,
    icon: ListIcon,
    presentation: projectAgentTodoPresentation,
    compactStep: compactStep.todoWrite,
    layout: { fullWidth: true, defaultCollapsed: false },
  },

  // ---------------------------------------------------------------------------
  // ToolOutputStore（超长工具输出续读）
  // ---------------------------------------------------------------------------
  'tool_output_read': {
    component: ToolOutputReadCard,
    icon: ReadIcon,
    presentation: projectToolOutputReadPresentation,
    compactStep: compactStep.toolOutput,
    layout: { fullWidth: true, defaultCollapsed: true },
  },

  // ---------------------------------------------------------------------------
  // 通用子任务（subagent）
  // ---------------------------------------------------------------------------
  'subagent': subagentToolUiConfig,
  'subrun_batch': {
    component: SubrunBatchCollection,
    presentation: projectSubrunBatchPresentation,
    compactStep: compactStep.subrunBatch,
    runtime: { subrunTrace: true },
    layout: {
      fullWidth: true,
      defaultCollapsed: true,
      // batch 是一个父工具消息，因此只拥有一个标准 ToolMessage 卡片外壳。
    },
  },
};
