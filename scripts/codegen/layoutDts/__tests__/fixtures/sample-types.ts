/**
 * Test fixture for extractTypes.
 * Mimics the shape of LayoutTypes.ts: external imports + exported
 * interfaces / type aliases / functions. Includes a non-exported
 * helper to verify it is excluded by default.
 */

import type { Foo, Bar } from './external/foo.js';
import type { Baz as RenamedBaz } from './external/baz.js';
import { isRecord } from './internal/typeGuards.js';

/** A simple props bag. */
export interface FooProps {
  /** width in inches */
  width?: number;
  /** optional foo */
  foo?: Foo;
}

/** Discriminated union helper. */
export type FooOrBar = Foo | Bar;

/** Renamed re-export. */
export type AliasedBaz = RenamedBaz;

/** A type guard. */
export function isFooProps(value: unknown): value is FooProps {
  if (!isRecord(value)) return false;
  return typeof (value as FooProps).width === 'number' || (value as FooProps).width === undefined;
}

// Non-exported helper — must be excluded.
interface InternalOnly {
  secret: string;
}

function helper(_: InternalOnly): void {
  /* no-op */
}
