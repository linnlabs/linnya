import type {
  EditableOperation,
  EditableTarget,
  PresentationRenderModel,
} from './renderModel';

export interface PresentationToolCapabilityMap {
  tools: string[];
  arrangementPlacements?: string[];
  alignmentActions?: string[];
  relayoutIntents?: string[];
  elementActions?: string[];
}

const CODEGEN_SOURCE_TOOLS = ['edit_file'] as const;

export const ARRANGEMENT_PLACEMENTS = ['front', 'back', 'forward', 'backward'] as const;

export const ALIGNMENT_ACTIONS = [
  'align_left',
  'align_center',
  'align_right',
  'align_top',
  'align_middle',
  'align_bottom',
  'distribute_horizontal',
  'distribute_vertical',
  'place_below',
  'center_in',
  'match_width',
  'match_height',
  'match_size',
] as const;

export const ELEMENT_ACTIONS = ['delete_element', 'duplicate_element'] as const;

export function buildNodeToolCapabilities(
  sourceKind: PresentationRenderModel['sourceKind'],
  editableTarget?: EditableTarget,
): PresentationToolCapabilityMap {
  if (!editableTarget) {
    return { tools: [] };
  }

  if (sourceKind === 'generated') {
    return {
      tools: editableTarget.operations.length > 0 ? [...CODEGEN_SOURCE_TOOLS] : [],
      arrangementPlacements: editableTarget.operations.includes('reorder_layer')
        ? [...ARRANGEMENT_PLACEMENTS]
        : undefined,
      alignmentActions: editableTarget.operations.includes('modify_geometry')
        ? [...ALIGNMENT_ACTIONS]
        : undefined,
      relayoutIntents: undefined,
      elementActions: [...ELEMENT_ACTIONS],
    };
  }

  return {
    tools: [],
    arrangementPlacements: undefined,
    alignmentActions: undefined,
    relayoutIntents: undefined,
    elementActions: undefined,
  };
}

export function buildSlideTools(
  sourceKind: PresentationRenderModel['sourceKind'],
): string[] {
  return sourceKind === 'generated'
    ? [...CODEGEN_SOURCE_TOOLS]
    : [];
}
