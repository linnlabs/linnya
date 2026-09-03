import type { SlideRasterErrorCode } from '@plugin/slides/shared/slideRasterization';

export class SlideRasterizationError extends Error {
  constructor(
    public readonly code: SlideRasterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SlideRasterizationError';
  }
}
