/**
 * PptInspectTool
 *
 * 检查 PPT 的布局质量。
 * 内部构建完整 feedback
 * （artifact / pageSummaries / sceneGraph / spatialAnalysis / buildStatus / findings），
 * 用它拼出给 AI 的标准化 finding observation；返回给 UI 的 data 只保留轻量摘要。
 */

import {
  BaseTool,
  type ToolContext,
  type ToolParameterProperty,
  type ToolParameterSchema,
} from '@plugin/backend/toolRuntime';
import { formatWorkspaceFileLocator, parseFileLocator } from '@app/schemas/file-locator';
import {
  PptInspectToolArgsSchema,
  PptInspectToolResultSchema,
  type PptInspectToolArgs,
  type PptInspectToolResult,
} from '@plugin/slides/shared';
import {
  projectDiagnosticFindings,
  summarizeDiagnosticProjection,
} from '../features/presentationInspection';
import {
  buildInspectObservation,
  type PptInspectObservationData,
} from './inspectObservation';
import {
  requirePresentationCoordinator,
  requirePresentationInspectTargetResolver,
} from './toolSupport';
import type { ResolvedPresentationInspectTarget } from './types';

const MAX_PAGES_PER_CALL = 10;

type InspectSelectorKey = 'presentation_id' | 'locator' | 'inode';

const SELECTOR_PROPERTIES: Readonly<Record<InspectSelectorKey, ToolParameterProperty>> = {
  presentation_id: {
    type: 'string',
    minLength: 1,
    description: '演示文稿 ID。与 locator、inode 三选一。',
  },
  locator: {
    type: 'string',
    minLength: 1,
    description: 'Workspace locator，例如 workspace:/项目资料/汇报.slides。与其他目标字段三选一。',
  },
  inode: {
    type: 'string',
    minLength: 1,
    description: '稳定 Workspace 节点标识。与其他目标字段三选一；长任务优先使用。',
  },
};

const PAGE_RANGE_PROPERTIES: Readonly<Record<'slideNumber' | 'endSlide', ToolParameterProperty>> = {
  slideNumber: {
    type: 'integer',
    minimum: 1,
    description: '起始页码（从 1 开始）。单独传表示只查该页；配合 endSlide 表示范围起点。',
  },
  endSlide: {
    type: 'integer',
    minimum: 1,
    description: '结束页码（含），必须与 slideNumber 同传且不能小于它。',
  },
};

const INSPECTION_PROPERTIES: Readonly<Record<'heuristics' | 'focus', ToolParameterProperty>> = {
  heuristics: {
    type: 'boolean',
    description: '是否附加 Tier-2 低置信启发式 info 提示。默认只返回确定性 finding。',
  },
  focus: {
    type: 'array',
    minItems: 1,
    maxItems: 4,
    description: '可选源码范围（最多 4 个）。只返回命中节点，以及不同范围在同页的最近节点间距/相交深度；行号从 1 开始且两端都包含。',
    items: {
      type: 'object',
      description: 'deck.js 中一个从 1 开始、两端都包含的源码范围。',
      additionalProperties: false,
      properties: {
        startLine: { type: 'integer', minimum: 1, description: 'deck.js 起始行（含）。' },
        endLine: { type: 'integer', minimum: 1, description: 'deck.js 结束行（含）。' },
      },
      required: ['startLine', 'endLine'],
    },
  },
};

export class PptInspectTool extends BaseTool {
  readonly name = 'ppt_inspect';

  get description() {
    return [
      '诊断演示文稿中可能存在的布局质量问题。',
      'observation 按统一 finding 合同给出问题代码、级别、证据、目标、源码位置与复验动作；data 只返回前端卡片需要的轻量统计。',
      '查看 deck.js 原文和页面组织请使用 read_file；修改时再用 edit_file。',
      '可选 heuristics=true 附加 Tier-2 低置信启发式提示。',
      `单次最多检查 ${MAX_PAGES_PER_CALL} 页；超出时返回 PPT_INSPECT_SCOPE_REQUIRED，不返回局部成功报告。请用 slideNumber+endSlide 分批检查。`,
    ].join(' ');
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...SELECTOR_PROPERTIES,
      ...PAGE_RANGE_PROPERTIES,
      ...INSPECTION_PROPERTIES,
    },
    required: [],
    oneOf: [
      {
        type: 'object',
        properties: {
          presentation_id: SELECTOR_PROPERTIES.presentation_id,
          ...INSPECTION_PROPERTIES,
        },
        required: ['presentation_id'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          presentation_id: SELECTOR_PROPERTIES.presentation_id,
          slideNumber: PAGE_RANGE_PROPERTIES.slideNumber,
          ...INSPECTION_PROPERTIES,
        },
        required: ['presentation_id', 'slideNumber'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          presentation_id: SELECTOR_PROPERTIES.presentation_id,
          ...PAGE_RANGE_PROPERTIES,
          ...INSPECTION_PROPERTIES,
        },
        required: ['presentation_id', 'slideNumber', 'endSlide'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          locator: SELECTOR_PROPERTIES.locator,
          ...INSPECTION_PROPERTIES,
        },
        required: ['locator'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          locator: SELECTOR_PROPERTIES.locator,
          slideNumber: PAGE_RANGE_PROPERTIES.slideNumber,
          ...INSPECTION_PROPERTIES,
        },
        required: ['locator', 'slideNumber'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          locator: SELECTOR_PROPERTIES.locator,
          ...PAGE_RANGE_PROPERTIES,
          ...INSPECTION_PROPERTIES,
        },
        required: ['locator', 'slideNumber', 'endSlide'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          inode: SELECTOR_PROPERTIES.inode,
          ...INSPECTION_PROPERTIES,
        },
        required: ['inode'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          inode: SELECTOR_PROPERTIES.inode,
          slideNumber: PAGE_RANGE_PROPERTIES.slideNumber,
          ...INSPECTION_PROPERTIES,
        },
        required: ['inode', 'slideNumber'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          inode: SELECTOR_PROPERTIES.inode,
          ...PAGE_RANGE_PROPERTIES,
          ...INSPECTION_PROPERTIES,
        },
        required: ['inode', 'slideNumber', 'endSlide'],
        additionalProperties: false,
      },
    ],
  };

  protected override validateArguments(args: Record<string, unknown>): {
    success: boolean;
    error?: string;
  } {
    const parsed = PptInspectToolArgsSchema.safeParse(args);
    if (parsed.success) return { success: true };
    return {
      success: false,
      error: `PPT_INSPECT_ARGUMENTS_INVALID: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
        .join('; ')}`,
    };
  }

  getExecutionSummary(output: string): string {
    try {
      const result = PptInspectToolResultSchema.parse(JSON.parse(output));
      const pages = formatSlideNumbers(result.data.selection.shownSlideNumbers);
      const summary = result.data.findingSummary;
      return `ppt_inspect：${result.data.document.title}`
        + `（${result.data.artifact.presentationId}@${result.data.artifact.versionId}），`
        + `已查 ${result.data.selection.shownSlideNumbers.length}/${result.data.artifact.slideCount} 页（${pages}），`
        + `所查范围 finding ${summary.uniqueFindingCount}/${summary.rawFindingCount}，`
        + `根因组 ${summary.rootGroupCount}，`
        + `P0/P1/P2=${summary.p0Count}/${summary.p1Count}/${summary.p2Count}。`;
    } catch {
      return 'ppt_inspect：结果无法解析。';
    }
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const input = PptInspectToolArgsSchema.parse(args);

    const coordinator = requirePresentationCoordinator(context);
    const target = await resolveInspectTarget(input, context);
    const presentationId = target.presentationId;

    const inspection = await coordinator.inspectPresentation({
      presentationId,
      selection: input.slideNumber === undefined
        ? { kind: 'all' }
        : input.endSlide === undefined
          ? { kind: 'single', slideNumber: input.slideNumber }
          : {
              kind: 'range',
              fromSlideNumber: input.slideNumber,
              toSlideNumber: input.endSlide,
            },
      maxSlides: MAX_PAGES_PER_CALL,
      includeHeuristics: input.heuristics === true,
      ...(input.focus ? { focus: input.focus } : {}),
    });
    const { feedback, renderModel: limitedModel, truncated } = inspection;
    if (truncated) {
      const requested = inspection.requestedSlideNumbers;
      const ranges: string[] = [];
      for (let index = 0; index < requested.length; index += MAX_PAGES_PER_CALL) {
        const batch = requested.slice(index, index + MAX_PAGES_PER_CALL);
        ranges.push(`slideNumber=${batch[0]},endSlide=${batch[batch.length - 1]}`);
      }
      // 未完整检查的请求没有可交付的成功统计，防止前半稿的 P0=0 被当作整稿通过。
      throw new Error(`PPT_INSPECT_SCOPE_REQUIRED: presentation=${presentationId}, version=${inspection.versionId}, `
        + `totalSlides=${inspection.totalSlideCount}, requestedSlides=${requested.length}. `
        + `每次最多检查 ${MAX_PAGES_PER_CALL} 页。请依次调用 ${ranges.join('；')}。`
        + '本次未返回完整检查结果，不能据此宣称任何请求范围已验收。');
    }

    const observationData: PptInspectObservationData = {
      presentationId: limitedModel.presentationId,
      slideCount: inspection.totalSlideCount,
      truncated,
      ...feedback,
    };

    const observation = buildInspectObservation(observationData);
    const findingSummary = summarizeDiagnosticProjection(
      projectDiagnosticFindings(feedback.findings),
    );
    const shownSlideNumbers = feedback.pageSummaries.map((page) => page.slideNumber);
    const toolResult: PptInspectToolResult = {
      data: {
        artifact: {
          presentationId: limitedModel.presentationId,
          versionId: inspection.versionId,
          slideCount: inspection.totalSlideCount,
        },
        document: {
          title: limitedModel.title,
          ...(target.path ? { locator: formatWorkspaceFileLocator(target.path) } : {}),
          ...(target.inode ? { inode: target.inode } : {}),
        },
        selection: {
          requestedSlideNumbers: [...inspection.requestedSlideNumbers],
          shownSlideNumbers,
          truncated,
        },
        pages: feedback.pageSummaries.map((page) => ({
          slideNumber: page.slideNumber,
          layoutKey: page.layoutKey,
          elementCount: page.elementCount,
          editableTargetCount: page.editableTargets.length,
        })),
        buildStatus: { state: 'ready' },
        findingSummary,
      },
      observation,
      observationPreviewMeta: {
        document_name: limitedModel.title,
        doc_type: 'slides/inspection',
      },
    };
    return JSON.stringify(PptInspectToolResultSchema.parse(toolResult));
  }
}

async function resolveInspectTarget(
  input: PptInspectToolArgs,
  context: ToolContext,
): Promise<ResolvedPresentationInspectTarget> {
  if (input.presentation_id !== undefined) {
    return { presentationId: input.presentation_id };
  }

  const path = input.locator ? (() => {
    const parsed = parseFileLocator(input.locator);
    if (parsed.kind !== 'workspace') {
      throw new Error('ppt_inspect 的 locator 必须使用 workspace: scheme。');
    }
    return parsed.path;
  })() : undefined;

  return requirePresentationInspectTargetResolver(context)({
    ...(path ? { path } : {}),
    ...(input.inode ? { inode: input.inode } : {}),
  });
}

function formatSlideNumbers(slideNumbers: readonly number[]): string {
  if (slideNumbers.length === 0) return '无';
  const first = slideNumbers[0];
  const last = slideNumbers[slideNumbers.length - 1];
  const contiguous = slideNumbers.every(
    (slideNumber, index) => slideNumber === first + index,
  );
  return contiguous && first !== last ? `${first}-${last}` : slideNumbers.join(',');
}
