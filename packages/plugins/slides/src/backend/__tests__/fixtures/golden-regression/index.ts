/**
 * Golden regression fixtures 索引。
 *
 * 这些 fixture 用于 compatibility / patch / parser 回归，
 * 不是当前 solver 视觉验收的主真值源。
 */
export { type GoldenFixture, type FixtureCategory, type FixtureExpectations } from './types.js';
export { consultingFixtures } from './consulting.js';
export { keynoteFixtures } from './keynote.js';
export { productFixtures } from './product.js';
export { financialFixtures } from './financial.js';
export { educationFixtures } from './education.js';
export { mixedLayoutFixtures } from './mixed-layout.js';

import { consultingFixtures } from './consulting.js';
import { keynoteFixtures } from './keynote.js';
import { productFixtures } from './product.js';
import { financialFixtures } from './financial.js';
import { educationFixtures } from './education.js';
import { mixedLayoutFixtures } from './mixed-layout.js';
import type { GoldenFixture } from './types.js';

export const GOLDEN_FIXTURES: GoldenFixture[] = [
  ...consultingFixtures,
  ...keynoteFixtures,
  ...productFixtures,
  ...financialFixtures,
  ...educationFixtures,
  ...mixedLayoutFixtures,
];
