import type {
  PptSourceSliceOutput,
  PptSourceSlicesOutput,
  PptSourceSliceTargetInput,
} from '../../../types/api';
import type {
  SlidesElementAiEditContext,
  SlidesElementAiEditContextInput,
  SlidesElementAiEditSubmitPayload,
  SlidesElementAiEditSourceTarget,
} from '../definitions/elementAiEditTypes';
import { SLIDES_PLUGIN_META } from '@plugin/slides/shared/pluginMeta';
import { generateConversationReferenceId } from '@app/schemas/conversation/reference-identity';

export function buildSlidesElementAiEditSourceTargets(
  payload: SlidesElementAiEditSubmitPayload,
): PptSourceSliceTargetInput[] {
  return payload.targets.map((target) => ({
    elementId: target.elementId,
    slideNumber: payload.slideNumber,
    kind: target.kind,
    sourceSpan: target.sourceSpan,
  }));
}

export function buildSlidesElementAiEditContext(
  input: SlidesElementAiEditContextInput,
): SlidesElementAiEditContext {
  const targets = buildSourceTargetsWithSummary(input.payload);
  const targetCount = input.payload.targets.length;
  const visiblePrompt = `修改第 ${input.payload.slideNumber} 页选中的 ${targetCount} 个元素：${input.payload.instruction}`;

  return {
    visiblePrompt,
    selectedSlidesElementFence: {
      kind: 'selected-slides-element',
      content: buildSelectedSlidesElementContent(
        input.presentationId,
        input.payload,
        targets,
        input.sourceSlices,
      ),
    },
    userQuote: {
      items: [{
        id: generateConversationReferenceId(),
        pluginId: SLIDES_PLUGIN_META.id,
        kind: 'slides-source-selection',
        text: buildUserQuoteText(input.payload),
        label: `第 ${input.payload.slideNumber} 页 · ${targetCount} 个元素`,
        source: {
          type: 'slides_source_selection',
          presentation_id: input.presentationId,
          source_file_inode: input.presentationId,
          slide_number: input.payload.slideNumber,
          source_key: input.sourceSlices.sourceKey,
          source_origin: input.sourceSlices.sourceOrigin,
          targets: targets.map((target) => ({
            element_id: target.elementId,
            kind: target.kind,
            source_span: target.sourceSpan,
          })),
        },
        metadata: {
          presentationId: input.presentationId,
          slideNumber: input.payload.slideNumber,
          elementIds: targets.map(target => target.elementId),
        },
      }],
    },
  };
}

function buildSelectedSlidesElementContent(
  presentationId: string,
  payload: SlidesElementAiEditSubmitPayload,
  targets: readonly SlidesElementAiEditSourceTarget[],
  sourceSlices: PptSourceSlicesOutput,
): string {
  return [
    buildContextHeader(presentationId, payload),
    '',
    buildDocumentFragment(targets, sourceSlices),
  ].join('\n');
}

function buildSourceTargetsWithSummary(
  payload: SlidesElementAiEditSubmitPayload,
): SlidesElementAiEditSourceTarget[] {
  return payload.targets.map((target) => ({
    elementId: target.elementId,
    slideNumber: payload.slideNumber,
    kind: target.kind,
    sourceSpan: target.sourceSpan,
    ...(target.summary ? { summary: target.summary } : {}),
  }));
}

function buildContextHeader(
  presentationId: string,
  payload: SlidesElementAiEditSubmitPayload,
): string {
  const targetLines = payload.targets
    .map((target, index) =>
      `${index + 1}. element=${target.elementId} kind=${target.kind} lines=${formatSpan(target.sourceSpan)}`)
    .join('\n');

  return [
    `source_file_inode: ${presentationId}`,
    `slide_number: ${payload.slideNumber}`,
    'source_policy: selection identifies the user target; snippets are old_string anchors; edit_file does not require read authorization; exact replacement failure means stale selection, so read_file the current source and retry.',
    'targets:',
    targetLines,
  ].join('\n');
}

function buildDocumentFragment(
  targets: readonly SlidesElementAiEditSourceTarget[],
  sourceSlices: { slices: PptSourceSliceOutput[] },
): string {
  const sections = sourceSlices.slices.map((slice, index) => {
    const target = targets.find((candidate) => candidate.elementId === slice.elementId);
    return [
      `<target index="${index + 1}" element_id="${slice.elementId}" slide_number="${slice.slideNumber}" kind="${slice.kind}" source_span="${formatSpan(slice.sourceSpan)}">`,
      target?.summary ? `summary: ${target.summary}` : 'summary: unavailable',
      `exact_source deck.js lines ${slice.startLine}-${slice.endLine}:`,
      '<<<deck.js exact source',
      slice.content,
      '>>>',
      '</target>',
    ].join('\n');
  });

  return [
    '<slides_element_source_context>',
    ...sections,
    '</slides_element_source_context>',
  ].join('\n');
}

function buildUserQuoteText(payload: SlidesElementAiEditSubmitPayload): string {
  return payload.targets
    .map((target, index) => {
      const summary = target.summary ? ` · ${target.summary}` : '';
      return `${index + 1}. ${target.kind} ${target.elementId} lines ${formatSpan(target.sourceSpan)}${summary}`;
    })
    .join('\n');
}

function formatSpan(span: { startLine: number; endLine: number }): string {
  return `${span.startLine}-${span.endLine}`;
}
