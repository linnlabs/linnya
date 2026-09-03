export const VIRTUALIZER_SPIKE_PAGE_SIZE = 12;
export const VIRTUALIZER_SPIKE_INITIAL_COUNT = 80;
export const VIRTUALIZER_SPIKE_NETWORK_DELAY_MS = 200;
export const VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX = 1;
export const VIRTUALIZER_SPIKE_CONTENT_PADDING_TOP_PX = 10;
export const VIRTUALIZER_SPIKE_CONTENT_PADDING_BOTTOM_PX = 24;
export const VIRTUALIZER_SPIKE_FOOTER_HEIGHT_PX = 96;
export const VIRTUALIZER_SPIKE_SCROLL_END_THRESHOLD_PX =
  VIRTUALIZER_SPIKE_CONTENT_PADDING_BOTTOM_PX + VIRTUALIZER_SPIKE_FOOTER_HEIGHT_PX + 1;
export const VIRTUALIZER_SPIKE_SAMPLE_FRAMES = 48;
export const VIRTUALIZER_SPIKE_PINNED_TAIL_COUNT = 3;
export const VIRTUALIZER_SPIKE_TIMELINE_ANIMATION_MS = 240;
export const VIRTUALIZER_SPIKE_CARD_SETTLE_FRAMES = 8;
export const VIRTUALIZER_SPIKE_PRODUCTION_PAGE_SIZE = 80;
export const VIRTUALIZER_SPIKE_PRODUCTION_WINDOW_ROWS = 320;

export interface VirtualizerSpikeImage {
  readonly delayMs: number;
  readonly heightPx: number;
  readonly widthPx: number;
}

export interface VirtualizerSpikeMessage {
  readonly id: string;
  readonly sequence: number;
  readonly author: 'assistant' | 'user';
  readonly paragraphs: readonly string[];
  readonly estimatedSize: number;
  readonly image: VirtualizerSpikeImage | null;
}

export interface VirtualizerSpikeFrameSample {
  readonly frame: number;
  readonly value: number | null;
}

export interface VirtualizerSpikeStabilityResult {
  readonly passed: boolean;
  readonly baseline: number;
  readonly maxDriftPx: number;
  readonly missingFrames: number;
  readonly samples: readonly VirtualizerSpikeFrameSample[];
}

export interface VirtualizerSpikeAdapterCapabilities {
  readonly anchorToEnd: boolean;
  readonly followOnAppend: boolean;
  readonly scrollEndThreshold: boolean;
  readonly scrollToEnd: boolean;
  readonly isAtEnd: boolean;
  readonly getDistanceFromEnd: boolean;
}

export interface VirtualizerSpikeGateReport {
  readonly status: 'failed' | 'idle' | 'passed' | 'running';
  readonly prepend: VirtualizerSpikeStabilityResult | null;
  readonly preserveHistoryOffset: VirtualizerSpikeStabilityResult | null;
  readonly tailPinning: VirtualizerSpikeStabilityResult | null;
  readonly pinnedTailRange: VirtualizerSpikeStabilityResult | null;
  readonly timelineResize: VirtualizerSpikeStabilityResult | null;
  readonly cardExpansion: VirtualizerSpikeStabilityResult | null;
  readonly scrollingMeasurement: VirtualizerSpikeStabilityResult | null;
  readonly initialEnd: VirtualizerSpikeStabilityResult | null;
  readonly stickyFooterGeometry: VirtualizerSpikeStabilityResult | null;
  readonly productionWindowChurn: VirtualizerSpikeStabilityResult | null;
}
