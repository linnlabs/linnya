import type {
  RendererStructuredContextRequirementInput,
  RendererStructuredContextRequirementResult,
} from '@plugin/renderer/structuredContextRequirementPort';

const SLIDES_ELEMENT_AI_EDIT_VISIBLE_PROMPT = /^修改第\s*\d+\s*页选中的\s*\d+\s*个元素：/;
const SLIDES_SOURCE_SELECTION_TYPE = 'slides_source_selection';
const SELECTED_SLIDES_ELEMENT_FENCE_KIND = 'selected-slides-element';

/**
 * 校验“可见短指令 + 隐藏结构化上下文”的成对协议。
 *
 * 中文说明：
 * - 点选编辑的可见 prompt 本身不包含 exact source，只是 UI 文案；
 * - 一旦该文案脱离 `selected-slides-element` fence 被普通对话入口发送，
 *   agent 就会回到全文读取和几何猜测，违背 slides 点选编辑的职责边界；
 * - 因此 Slides 插件在 conversation 发送入口注册最后一道协议闸门。
 */
export function validateSlidesElementAiEditStructuredContext(
  input: RendererStructuredContextRequirementInput,
): RendererStructuredContextRequirementResult {
  if (!isSlidesElementAiEditRequest(input)) {
    return { ok: true };
  }

  const selectedSlidesElementFence = input.options.fences?.find(
    fence => fence.kind === SELECTED_SLIDES_ELEMENT_FENCE_KIND,
  );
  const hasSelectedSlidesElementFence =
    selectedSlidesElementFence?.content.includes('source_file_inode') === true
    && selectedSlidesElementFence.content.includes('<<<deck.js exact source') === true;

  if (hasSelectedSlidesElementFence) {
    return { ok: true };
  }

  return {
    ok: false,
    message: '点选编辑缺少精确源码上下文。请刷新演示文稿后重新选择元素再发送。',
  };
}

function isSlidesElementAiEditRequest(input: RendererStructuredContextRequirementInput): boolean {
  const hasSlidesSourceSelection = input.options.userQuote?.items.some(
    item => readUserQuoteSourceType(item.source) === SLIDES_SOURCE_SELECTION_TYPE,
  ) === true;
  return hasSlidesSourceSelection
    || SLIDES_ELEMENT_AI_EDIT_VISIBLE_PROMPT.test(input.prompt);
}

function readUserQuoteSourceType(source: Record<string, unknown> | undefined): string | null {
  const value = source?.type;
  return typeof value === 'string' ? value : null;
}
