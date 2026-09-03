// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@plugin/renderer/subrunToolUi', () => ({
  SubrunCard: defineComponent({ name: 'SubrunCardStub' }),
}));

import { slidesToolManifest } from '../../backend/toolManifest';
import { slidesRendererPlugin } from '../index';

const slidesPackageDirectory = path.resolve(import.meta.dirname, '../../..');

function listRuntimeSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : listRuntimeSourceFiles(filePath);
    }
    return /\.(ts|tsx|vue)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)
      ? [filePath]
      : [];
  });
}

function hasRuntimeImport(source: string, moduleId: string): boolean {
  const importPattern = /import\s+(?!type\b)([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let match = importPattern.exec(source);
  while (match) {
    if (match[2] === moduleId) return true;
    match = importPattern.exec(source);
  }
  return false;
}

describe('Slides renderer ownership contract', () => {
  it('covers every registered backend tool with live full and compact presentations', () => {
    const toolCards = slidesRendererPlugin.toolCards;
    expect(toolCards).toBeDefined();

    for (const toolName of slidesToolManifest.allNames) {
      const entry = toolCards?.[toolName];
      expect(entry).toBeDefined();
      expect(entry && 'presentation' in entry && typeof entry.presentation === 'function').toBe(true);
      expect(entry && 'compactStep' in entry && typeof entry.compactStep === 'function').toBe(true);
      expect(entry && 'title' in entry).toBe(false);
    }
  });

  it('keeps renderer runtime imports off the shared barrel that also exports backend-only helpers', () => {
    const offenders = listRuntimeSourceFiles(path.join(slidesPackageDirectory, 'src/renderer'))
      .filter((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        return hasRuntimeImport(source, '@plugin/slides/shared');
      });

    expect(offenders).toEqual([]);
  });
});
