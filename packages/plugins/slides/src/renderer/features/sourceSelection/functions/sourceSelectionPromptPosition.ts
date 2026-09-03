import { INCHES_TO_PX } from '../../../shared/constants';
import type {
  SourceSelectableElement,
  SourceSelectionRect,
} from '../definitions/sourceSelectionTypes';

export interface SourceSelectionPromptPositionInput {
  targets: readonly SourceSelectableElement[];
  renderScale: number;
  slideSize: {
    width: number;
    height: number;
  };
  slideViewportRect?: {
    left: number;
    top: number;
  };
  viewportSize?: {
    width: number;
    height: number;
  };
}

export interface SourceSelectionPromptPosition {
  leftPx: number;
  topPx: number;
  placement: 'below';
}

const PROMPT_VERTICAL_GAP_PX = 12;
const PROMPT_VIEWPORT_MARGIN_PX = 16;
const PROMPT_ESTIMATED_WIDTH_PX = 320;
const PROMPT_ESTIMATED_HEIGHT_PX = 46;

export function resolveSourceSelectionPromptPosition(
  input: SourceSelectionPromptPositionInput,
): SourceSelectionPromptPosition | null {
  if (input.targets.length === 0 || input.renderScale <= 0) {
    return null;
  }

  const bounds = unionTargetBounds(input.targets.map((target) => target.bounds));
  if (!bounds) {
    return null;
  }

  const slideWidthPx = input.slideSize.width * INCHES_TO_PX * input.renderScale;
  const centerX = (bounds.x + bounds.w / 2) * INCHES_TO_PX * input.renderScale;
  const bottomCandidate = (bounds.y + bounds.h) * INCHES_TO_PX * input.renderScale + PROMPT_VERTICAL_GAP_PX;
  const slideLeft = input.slideViewportRect?.left ?? 0;
  const slideTop = input.slideViewportRect?.top ?? 0;
  const viewportWidth = input.viewportSize?.width ?? slideWidthPx;
  const viewportHeight = input.viewportSize?.height;
  const leftCandidate = slideLeft + centerX;
  const topCandidate = slideTop + bottomCandidate;

  return {
    leftPx: clamp(
      leftCandidate,
      PROMPT_VIEWPORT_MARGIN_PX + PROMPT_ESTIMATED_WIDTH_PX / 2,
      Math.max(
        PROMPT_VIEWPORT_MARGIN_PX + PROMPT_ESTIMATED_WIDTH_PX / 2,
        viewportWidth - PROMPT_VIEWPORT_MARGIN_PX - PROMPT_ESTIMATED_WIDTH_PX / 2,
      ),
    ),
    topPx: viewportHeight === undefined
      ? topCandidate
      : clamp(
        topCandidate,
        PROMPT_VIEWPORT_MARGIN_PX,
        Math.max(PROMPT_VIEWPORT_MARGIN_PX, viewportHeight - PROMPT_VIEWPORT_MARGIN_PX - PROMPT_ESTIMATED_HEIGHT_PX),
      ),
    placement: 'below',
  };
}

function unionTargetBounds(boundsList: readonly SourceSelectionRect[]): SourceSelectionRect | null {
  const first = boundsList[0];
  if (!first) {
    return null;
  }

  let minX = first.x;
  let minY = first.y;
  let maxX = first.x + first.w;
  let maxY = first.y + first.h;
  for (const bounds of boundsList.slice(1)) {
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.w);
    maxY = Math.max(maxY, bounds.y + bounds.h);
  }

  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
