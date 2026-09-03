// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

vi.mock('@plugin/renderer/subrunToolUi', () => ({
  SubrunCard: defineComponent({ name: 'SubrunCardStub' }),
}));

import { mindmapToolManifest } from '@plugin/mindmap/backend-test-support';
import { mindmapRendererPlugin } from '../index';

describe('Mindmap renderer ownership contract', () => {
  it('covers every registered backend tool with live full and compact presentations', () => {
    const toolCards = mindmapRendererPlugin.toolCards;
    expect(toolCards).toBeDefined();

    for (const toolName of mindmapToolManifest.allNames) {
      const entry = toolCards?.[toolName];
      expect(entry).toBeDefined();
      expect(entry && 'presentation' in entry && typeof entry.presentation === 'function').toBe(true);
      expect(entry && 'compactStep' in entry && typeof entry.compactStep === 'function').toBe(true);
      expect(entry && 'title' in entry).toBe(false);
    }
  });
});
