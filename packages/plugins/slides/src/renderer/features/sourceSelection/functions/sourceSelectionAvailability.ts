import type {
  PresentationRenderModel,
  SlideRenderModel,
} from '../../../types/render';
import { collectSourceSelectableElements } from './renderNodeSourceSelection';

export type SourceSelectionUnavailableReason =
  | 'no-render-model'
  | 'semantic-render-unavailable'
  | 'source-edit-capability-unavailable'
  | 'no-current-slide'
  | 'current-slide-konva-unsupported'
  | 'no-source-backed-elements';

export interface SourceSelectionAvailabilityInput {
  renderModel: PresentationRenderModel | null;
  currentSlideRender: SlideRenderModel | null;
  currentSlideKonvaCompatible: boolean;
}

export interface SourceSelectionAvailability {
  canEnableMode: boolean;
  reason: SourceSelectionUnavailableReason | null;
  label: string;
  selectableElementCount: number;
  sourceKind: PresentationRenderModel['sourceKind'] | null;
  capabilities: PresentationRenderModel['capabilities'] | null;
}

export function resolveSourceSelectionAvailability(
  input: SourceSelectionAvailabilityInput,
): SourceSelectionAvailability {
  const sourceKind = input.renderModel?.sourceKind ?? null;
  const capabilities = input.renderModel?.capabilities ?? null;
  const selectableElementCount = input.currentSlideRender
    ? collectSourceSelectableElements(input.currentSlideRender.elements).length
    : 0;

  const reason = resolveUnavailableReason(input, selectableElementCount);
  return {
    canEnableMode: reason === null,
    reason,
    label: reason ? formatSourceSelectionUnavailableReason(reason) : '可以选择 PPT 元素',
    selectableElementCount,
    sourceKind,
    capabilities,
  };
}

export function formatSourceSelectionUnavailableReason(
  reason: SourceSelectionUnavailableReason,
): string {
  switch (reason) {
    case 'no-render-model':
      return '渲染模型还没有加载完成';
    case 'semantic-render-unavailable':
      return '当前预览不是语义渲染模型，无法稳定命中元素';
    case 'source-edit-capability-unavailable':
      return '当前演示文稿没有可编辑源码定位，不能把选中元素发给 AI 精确修改';
    case 'no-current-slide':
      return '当前没有可渲染页面';
    case 'current-slide-konva-unsupported':
      return '当前页面包含暂不支持的 Konva 节点';
    case 'no-source-backed-elements':
      return '当前页面没有带源码行号的可选元素';
  }
}

function resolveUnavailableReason(
  input: SourceSelectionAvailabilityInput,
  selectableElementCount: number,
): SourceSelectionUnavailableReason | null {
  if (!input.renderModel) {
    return 'no-render-model';
  }
  if (input.renderModel.capabilities.hasSemanticRender !== true) {
    return 'semantic-render-unavailable';
  }
  if (input.renderModel.capabilities.canEditSourceSelection !== true) {
    return 'source-edit-capability-unavailable';
  }
  if (!input.currentSlideRender) {
    return 'no-current-slide';
  }
  if (!input.currentSlideKonvaCompatible) {
    return 'current-slide-konva-unsupported';
  }
  if (selectableElementCount === 0) {
    return 'no-source-backed-elements';
  }
  return null;
}
