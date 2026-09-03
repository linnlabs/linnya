import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';

describe('official plugin root script naming', () => {
  it('uses plugin-scoped official plugin script names instead of legacy ai-ppt/ppt aliases', () => {
    const scripts = packageJson.scripts;
    const pluginTestScriptNames = Object.keys(scripts).filter(name =>
      name.startsWith('test:plugin:')
    );

    expect(pluginTestScriptNames.length).toBeGreaterThan(0);
    for (const scriptName of pluginTestScriptNames) {
      const pluginId = scriptName.slice('test:plugin:'.length);
      expect(
        fs.existsSync(path.join(process.cwd(), 'packages/plugins', pluginId, 'package.json'))
      ).toBe(true);
    }
    expect(scripts).toHaveProperty('test:workspace-plugins');
    expect(scripts).not.toHaveProperty('test:ai-ppt');
    expect(scripts).not.toHaveProperty('ppt:harness');
    expect(scripts).not.toHaveProperty('ppt:seed:dev');
  });
});
