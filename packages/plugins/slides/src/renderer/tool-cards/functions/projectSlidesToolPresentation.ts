import type {
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
  ToolTitleDescriptor,
} from '@linnya/plugin-host-contract/renderer/toolUi';
import { PptInspectToolMessageResultSchema } from '@plugin/slides/shared/pptInspectToolContract';
import {
  PptPlanDataSchema,
  type PptPlanData,
} from '@plugin/slides/shared/pptPlanToolContract';

import {
  SLIDES_TOOL_CARD_MESSAGE_FALLBACKS,
  type SlidesToolCardMessageKey,
} from '../definitions/slidesToolCardMessageCatalog';
import type {
  SlidesDirectionPresentationData,
  SlidesExportPresentationData,
  SlidesInspectPresentationData,
  PresentationPageSummary,
  SlidesPlanInteractionPresentation,
  SlidesPlanPresentationData,
} from '../definitions/slidesToolPresentation';
import {
  readPptPlanData,
} from '../presentation/pptPlanInteraction';
import {
  isSlidesToolRecord,
  readSlidesToolNumber,
  readSlidesToolString,
  type SlidesToolRecord,
} from './readSlidesToolPayload';

function requireResultData(value: unknown, toolName: string): SlidesToolRecord {
  if (!isSlidesToolRecord(value) || !isSlidesToolRecord(value['data'])) {
    throw new Error(`${toolName} success result 缺少正式 data 对象`);
  }
  return value['data'];
}

function localizedText(
  key: SlidesToolCardMessageKey,
  params?: Readonly<Record<string, string | number>>,
) {
  return {
    key,
    fallback: SLIDES_TOOL_CARD_MESSAGE_FALLBACKS[key],
    ...(params ? { params } : {}),
  };
}

function requirePlan(value: unknown, path: string): PptPlanData {
  const root = isSlidesToolRecord(value) ? value : null;
  const data = root && isSlidesToolRecord(root['data']) ? root['data'] : root;
  const parsed = PptPlanDataSchema.safeParse(data);
  if (parsed.success) return parsed.data;
  throw new Error(`${path} 缺少有效 PPT 计划：${parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'data'}: ${issue.message}`)
    .join('; ')}`);
}

function requirePlanFromArgs(value: unknown): PptPlanData {
  const plan = readPptPlanData(value);
  if (plan) return plan;
  throw new Error('ppt_plan 交互终态缺少原始计划参数');
}

function projectPlanInteraction(
  input: ToolPresentationProjectorInput,
): SlidesPlanInteractionPresentation {
  const interaction = input.interaction;
  if (!interaction || interaction.status === 'active') return { status: 'active' };
  if (interaction.status === 'approved') {
    return {
      status: 'approved',
      ...(interaction.submittedAt === undefined ? {} : { submittedAt: interaction.submittedAt }),
    };
  }
  if (interaction.status === 'modified') {
    if (!isSlidesToolRecord(interaction.response)) {
      throw new Error('ppt_plan modified interaction 缺少 response');
    }
    const notes = readSlidesToolString(interaction.response['notes']);
    return {
      status: 'modified',
      ...(interaction.submittedAt === undefined ? {} : { submittedAt: interaction.submittedAt }),
      ...(notes ? { notes } : {}),
      ...(interaction.response['paletteChanged'] === true ? { paletteChanged: true } : {}),
      modifiedPlan: requirePlan(interaction.response['plan'], 'ppt_plan modified response.plan'),
    };
  }
  throw new Error(`ppt_plan 不支持 interaction status=${interaction.status}`);
}

export function projectSlidesPlanPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<SlidesPlanPresentationData> {
  if (!input.toolCallId) throw new Error('ppt_plan presentation 缺少 toolCallId');
  const interaction = projectPlanInteraction(input);
  // 封面版本只在工具结果里（backend 解析 look.presentation 后写入），等待审批与审批之后都先读结果；
  // 流式生成参数时还没有结果，或结果已被用户提交覆盖时，再退回原始参数。
  const plan = interaction.status === 'active'
    ? (input.status === 'success'
        ? requirePlan(input.result, 'ppt_plan result')
        : readPptPlanData(input.result) ?? readPptPlanData(input.args))
    : readPptPlanData(input.result) ?? requirePlanFromArgs(input.args);
  return {
    data: {
      kind: 'plan',
      toolCallId: input.toolCallId,
      plan,
      interaction,
    },
  };
}

function inspectTitle(title: string | null): ToolTitleDescriptor {
  return {
    text: title
      ? localizedText('slides.tool.title.inspectNamed', { title })
      : localizedText('slides.tool.title.inspect'),
  };
}

export function projectSlidesInspectPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<SlidesInspectPresentationData> {
  if (input.status !== 'success') {
    return {
      data: {
        kind: 'inspect',
        presentationId: null,
        title: null,
        slideCount: null,
        pages: [],
      },
      title: inspectTitle(null),
    };
  }
  const result = PptInspectToolMessageResultSchema.parse(input.result);
  const { artifact, document, pages } = result.data;
  return {
    data: {
      kind: 'inspect',
      presentationId: artifact.presentationId,
      title: document.title,
      slideCount: artifact.slideCount,
      pages: pages satisfies readonly PresentationPageSummary[],
    },
    title: inspectTitle(document.title),
  };
}

function exportTitle(fileName: string | null): ToolTitleDescriptor {
  return {
    text: fileName
      ? localizedText('slides.tool.title.exportNamed', { fileName })
      : localizedText('slides.tool.title.export'),
  };
}

export function projectSlidesDirectionPresentation(
  _input: ToolPresentationProjectorInput,
): ToolPresentationProjection<SlidesDirectionPresentationData> {
  return {
    data: { kind: 'direction' },
    title: { text: localizedText('slides.tool.title.direction') },
  };
}

export function projectSlidesExportPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<SlidesExportPresentationData> {
  if (input.status !== 'success') {
    return {
      data: { kind: 'export', presentationId: null, fileName: null, sizeBytes: null },
      title: exportTitle(null),
    };
  }
  const data = requireResultData(input.result, 'ppt_export');
  const presentationId = readSlidesToolString(data['presentationId']);
  const fileName = readSlidesToolString(data['fileName']);
  const sizeBytes = readSlidesToolNumber(data['sizeBytes']);
  if (!presentationId || !fileName || sizeBytes === undefined) {
    throw new Error('ppt_export result 缺少 presentationId/fileName/sizeBytes');
  }
  return {
    data: { kind: 'export', presentationId, fileName, sizeBytes },
    title: exportTitle(fileName),
  };
}
