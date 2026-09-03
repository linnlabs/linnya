import { describe, expect, it } from 'vitest';

import { HOST_SCHEMA_BASELINE_VERSION, migrations, SCHEMA_VERSION } from '../index';

describe('Host Schema migration registry', () => {
  it('covers every supported version transition exactly once and in order', () => {
    const expectedSourceVersions = Array.from(
      { length: SCHEMA_VERSION - HOST_SCHEMA_BASELINE_VERSION },
      (_, index) => HOST_SCHEMA_BASELINE_VERSION + index
    );

    expect(migrations.map(migration => migration.fromVersion)).toEqual(expectedSourceVersions);
  });
});
