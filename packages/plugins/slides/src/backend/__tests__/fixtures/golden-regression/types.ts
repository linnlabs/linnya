/**
 * Golden Fixture 类型定义
 */
import type { DeckSpec, PatchSpec } from '@plugin/slides/shared';

export type FixtureCategory =
  | 'consulting'
  | 'keynote'
  | 'product'
  | 'financial'
  | 'education'
  | 'mixed-layout';

export interface FixtureExpectations {
  slideCount: number;
  elementTypes: string[];
  hasTheme?: boolean;
}

export interface GoldenFixture {
  id: string;
  name: string;
  category: FixtureCategory;
  description: string;
  deckSpec: DeckSpec;
  patchSpecs?: PatchSpec[];
  expectations: FixtureExpectations;
}
