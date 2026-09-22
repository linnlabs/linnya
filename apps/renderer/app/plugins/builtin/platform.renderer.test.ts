// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/app-hosts/linnya/plugin-registry/builtin', () => ({
  getRegisteredSubagentTypes: () => [],
}));
import { tableFillToolCards } from '@/app/workflows/table-fill/ui/tool-card/tableFillToolCards';
import { commonToolConfigs } from '@/domains/conversation/ui/tools/configs/common';
import { workspaceReadToolConfigs } from '@/domains/conversation/ui/tools/configs/workspace';
import { platformRendererPlugin } from './platform.renderer';
import { legacyBuiltinToolClasses } from '../../../../../src/app-hosts/linnya/adapters/tools/legacyToolClasses';

vi.mock('@/domains/workspace/services/file-manager/handlers/markdown', () => ({
  markdownHandler: {},
}));
vi.mock('./surfaces/MarkdownDocumentSurface.vue', () => ({
  default: {},
}));

describe('platformRendererPlugin table-fill contribution', () => {
  it('由 always-enabled platform 注册工具卡，conversation common config 不持有业务工具名', () => {
    expect(platformRendererPlugin.toolCards?.['write_to_table'])
      .toBe(tableFillToolCards['write_to_table']);
    expect(commonToolConfigs['write_to_table']).toBeUndefined();
  });

  it('所有 live 平台工具都有完整卡片与紧凑步骤 projector', () => {
    const toolCards = platformRendererPlugin.toolCards ?? {};
    for (const ToolClass of legacyBuiltinToolClasses) {
      const toolName = new ToolClass().name;
      const entry = toolCards[toolName];
      expect(entry, toolName).toBeDefined();
      if (toolName === 'read_file') {
        expect(entry).toBe(workspaceReadToolConfigs['read_file']);
        const finalEntry = toolCards['workspace_read_file'];
        expect(finalEntry && 'presentation' in finalEntry && typeof finalEntry.presentation === 'function')
          .toBe(true);
        expect(finalEntry && 'compactStep' in finalEntry && typeof finalEntry.compactStep === 'function')
          .toBe(true);
      } else {
        expect(entry && 'presentation' in entry && typeof entry.presentation === 'function', toolName)
          .toBe(true);
        expect(entry && 'compactStep' in entry && typeof entry.compactStep === 'function', toolName)
          .toBe(true);
        expect(entry && 'title' in entry, toolName).toBe(false);
      }
    }
  });
});
