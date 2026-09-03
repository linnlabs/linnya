import type { VirtualizerSpikeStabilityResult } from './virtualizerSpike';

export const VIRTUALIZER_DYNAMIC_MATRIX_ANCHOR_THRESHOLD_PX = 1;
export const VIRTUALIZER_DYNAMIC_MATRIX_OUTER_HEIGHT_THRESHOLD_PX = 1;
export const VIRTUALIZER_DYNAMIC_MATRIX_EXPECTED_DRIFT_MIN_PX = 24;
export const VIRTUALIZER_DYNAMIC_MATRIX_SAMPLE_FRAMES = 8;

export type VirtualizerDynamicPolicy = 'default' | 'fully-above';
export type VirtualizerDynamicGranularity = 'turn' | 'visual-row';
export type VirtualizerDynamicScenario =
  | 'image-growth'
  | 'chart-growth'
  | 'bash-growth'
  | 'chart-shrink'
  | 'batch-resize'
  | 'prepend-resize'
  | 'bounded-nested-growth';
export type VirtualizerDynamicExpectation = 'drift' | 'stable';

export interface VirtualizerDynamicBlock {
  readonly id: string;
  readonly kind: 'bash' | 'chart' | 'image';
  readonly extent: number;
}

export type VirtualizerDynamicFixtureRow =
  | {
      readonly id: string;
      readonly kind: 'anchor';
      readonly estimatedSize: number;
      readonly anchorKey: string;
    }
  | {
      readonly id: string;
      readonly kind: 'dynamic';
      readonly estimatedSize: number;
      readonly block: VirtualizerDynamicBlock;
      readonly bounded: boolean;
    }
  | {
      readonly id: string;
      readonly kind: 'spacer';
      readonly estimatedSize: number;
      readonly heightPx: number;
    }
  | {
      readonly id: string;
      readonly kind: 'turn';
      readonly estimatedSize: number;
      readonly anchorKey: string;
      readonly blocks: readonly VirtualizerDynamicBlock[];
      readonly bounded: boolean;
    };

export interface VirtualizerDynamicScenarioFixture {
  readonly rows: readonly VirtualizerDynamicFixtureRow[];
  readonly anchorKey: string;
  readonly measuredRowKey: string;
}

export interface VirtualizerDynamicMatrixCaseResult {
  readonly id: string;
  readonly policy: VirtualizerDynamicPolicy;
  readonly granularity: VirtualizerDynamicGranularity;
  readonly scenario: VirtualizerDynamicScenario;
  readonly expectation: VirtualizerDynamicExpectation;
  readonly stability: VirtualizerSpikeStabilityResult;
  readonly predicateCalls: number;
  readonly predicateMatches: number;
  readonly backwardScrollObserved: boolean;
  readonly scrollCorrectionPx: number;
  readonly outerHeightDeltaPx: number;
  readonly expectationMet: boolean;
}

export interface VirtualizerDynamicMatrixReport {
  readonly status: 'failed' | 'idle' | 'passed' | 'running';
  readonly cases: readonly VirtualizerDynamicMatrixCaseResult[];
}
