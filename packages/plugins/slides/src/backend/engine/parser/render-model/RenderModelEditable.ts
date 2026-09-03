import type {
  FreeformElement,
  StructuredElement,
} from '@plugin/slides/shared';
import type {
  CanonicalElement,
  EditableOperation,
  EditableTarget,
  RelayoutCapability,
} from '@plugin/slides/shared';

export function buildGeneratedEditableTarget(
  slideNumber: number,
  elementId: string,
  element: StructuredElement | FreeformElement,
): EditableTarget | undefined {
  const operations = resolveGeneratedEditableOperations(element);
  if (operations.length === 0) {
    return undefined;
  }

  const semanticNodeId = element._semanticNodeId;
  const semanticRole = element._semanticRole;
  const supportsRelayout = semanticNodeId != null || semanticRole != null;

  return {
    slideNumber,
    elementId,
    semanticNodeId,
    semanticRole,
    operations: supportsRelayout ? [...operations, 'relayout_slide'] : operations,
    imageEditCapabilities: element.type === 'image'
      ? { replaceSource: true, editVisuals: true }
      : undefined,
    relayoutCapabilities: supportsRelayout ? resolveRelayoutCapabilities(element) : undefined,
  };
}

export function buildCanonicalEditableTarget(
  element: CanonicalElement,
): EditableTarget | undefined {
  const operations = resolveCanonicalEditableOperations(element);
  if (operations.length === 0) {
    return undefined;
  }

  return {
    elementId: element.elementId,
    creationId: element.patchMeta.creationId,
    elementName: element.patchMeta.elementName,
    operations,
    imageEditCapabilities: element.role === 'image'
      ? { replaceSource: true, editVisuals: false }
      : undefined,
  };
}

function resolveGeneratedEditableOperations(
  element: StructuredElement | FreeformElement,
): EditableOperation[] {
  if (element.type === 'group') {
    return [];
  }

  switch (element.type) {
    case 'title':
    case 'text':
    case 'bulletList':
    case 'numberedList':
      return ['modify_text', 'modify_style', 'modify_geometry', 'reorder_layer'];
    case 'shape': {
      const hasText = (
        ('text' in element && typeof element.text === 'string' && element.text.length > 0)
        || ('content' in element && typeof element.content === 'string' && element.content.length > 0)
      );
      return hasText
        ? ['modify_text', 'modify_style', 'modify_geometry', 'reorder_layer']
        : ['modify_style', 'modify_geometry', 'reorder_layer'];
    }
    case 'image':
      return ['edit_image', 'modify_geometry', 'reorder_layer'];
    case 'svgGraphic':
    case 'formula':
      return ['modify_geometry', 'reorder_layer'];
    case 'table':
      return ['update_table', 'modify_geometry', 'reorder_layer'];
    case 'chart':
      return ['update_chart', 'modify_geometry', 'reorder_layer'];
  }
}

function resolveCanonicalEditableOperations(
  element: CanonicalElement,
): EditableOperation[] {
  switch (element.role) {
    case 'title':
    case 'body':
      return ['modify_text', 'modify_style', 'modify_geometry', 'reorder_layer'];
    case 'shape':
      return ['modify_style', 'modify_geometry', 'reorder_layer'];
    case 'image':
      return ['edit_image', 'modify_geometry', 'reorder_layer'];
    case 'svgGraphic':
      return ['modify_geometry', 'reorder_layer'];
    case 'table':
      return ['update_table', 'modify_geometry', 'reorder_layer'];
    case 'chart':
      return ['update_chart', 'modify_geometry', 'reorder_layer'];
    case 'group':
    case 'other':
      return [];
  }
}

function resolveRelayoutCapabilities(
  element: StructuredElement | FreeformElement,
): RelayoutCapability[] {
  if (element.type === 'group') {
    return [];
  }

  switch (element.type) {
    case 'chart':
    case 'table':
    case 'image':
    case 'svgGraphic':
    case 'formula':
      return ['promote', 'demote', 'expand', 'shrink', 'swap_primary', 'move_to_region'];
    case 'title':
    case 'text':
    case 'bulletList':
    case 'numberedList':
      return ['promote', 'demote', 'expand', 'shrink', 'move_to_region'];
    case 'shape':
      return ['expand', 'shrink', 'move_to_region'];
  }
}
