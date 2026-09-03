import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  analyzeLine,
  analyzeSourceText,
  collectPluginContractGuardViolations,
  extractImportsFromSource,
  parseBaselineEntries,
  partitionBaselineViolations,
  validateDeepImportBaselineState,
  type AnalyzeImportOptions,
  type Violation,
} from '../guards/agent-package-boundary-guard';

const repoRoot = path.resolve(__dirname, '../..');

function ruleIdsFor(file: string, preview: string, options?: AnalyzeImportOptions): string[] {
  return analyzeLine(file, 1, preview, options).map((violation) => violation.ruleId);
}

function sourceRuleIdsFor(file: string, source: string): string[] {
  return analyzeSourceText(file, source).map((violation) => violation.ruleId);
}

function violationFor(file: string, line: number, preview: string, ruleId: string): Violation {
  const violation = analyzeLine(file, line, preview).find((candidate) => candidate.ruleId === ruleId);
  expect(violation).toBeDefined();
  if (violation === undefined) {
    throw new Error(`expected violation ${ruleId} for ${file}`);
  }
  return violation;
}

describe('AGENT-GUARD-07-no-host-deep-import', () => {
  it('flags host deep import into agent internals', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts',
        "import { LlmCaller } from 'src/agent/runtime-kernel/llm/caller';",
      ),
    ).toContain('AGENT-GUARD-07-no-host-deep-import');
  });

  it('allows host import from public sub-entry', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts',
        "import { runtimeKernel } from 'src/agent/runtime-kernel';",
      ),
    ).toEqual([]);
  });

  it('allows host import from contracts entry', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/adapters/flow/flow.stream-handler.ts',
        "import type { RuntimeEvent } from 'src/agent/contracts';",
      ),
    ).toEqual([]);
  });

  it('allows host import from root entry', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts',
        "import { generateMessageId } from 'src/agent';",
      ),
    ).toEqual([]);
  });

  it('exempts src/agent internal files', () => {
    expect(
      ruleIdsFor(
        'src/agent/runtime-kernel/llm/caller.ts',
        "import type { AgentAiEngine } from '../../ports/ai-engine';",
      ),
    ).not.toContain('AGENT-GUARD-07-no-host-deep-import');
  });

  it('exempts tests', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/adapters/flow/__tests__/runBootstrapper.test.ts',
        "import { GraphExecutor } from 'src/agent/runtime-kernel/graph-engine/engine';",
      ),
    ).toEqual([]);
  });

});

describe('AGENT-GUARD-08-no-cross-submodule-deep-import', () => {
  it('flags deep import into another top-level agent submodule', () => {
    expect(
      ruleIdsFor(
        'src/agent/runtime-kernel/graph-engine/executorContextBuilder.ts',
        "import type { AgentTaskResolver } from '../../context-manager/profiles/agent/tasks/base';",
      ),
    ).toContain('AGENT-GUARD-08-no-cross-submodule-deep-import');
  });

  it('allows import through another submodule public entry', () => {
    expect(
      ruleIdsFor(
        'src/agent/runtime-kernel/graph-engine/executorContextBuilder.ts',
        "import * as contextManager from '../../context-manager';",
      ),
    ).toEqual([]);
  });

  it('allows shared utilities', () => {
    expect(
      ruleIdsFor(
        'src/agent/runtime-kernel/graph-engine/tick-pipeline/middlewares/llmTelemetryMiddleware.ts',
        "import { TokenCalculator } from '../../../shared/TokenCalculator';",
      ),
    ).toEqual([]);
  });
});

describe('AGENT-GUARD-09-no-internal-only-import', () => {
  it('flags non-agent imports of internal-only shared paths', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/adapters/tools/toolRegistry.ts',
        "import { TokenCalculator } from 'src/agent/shared/TokenCalculator';",
      ),
    ).toContain('AGENT-GUARD-09-no-internal-only-import');
  });

  it('allows stable shared ids import', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/adapters/tools/toolRegistry.ts',
        "import { generateMessageId } from 'src/agent/shared/ids';",
      ),
    ).not.toContain('AGENT-GUARD-09-no-internal-only-import');
  });

  it('allows internal-only shared usage inside src/agent', () => {
    expect(
      ruleIdsFor(
        'src/agent/context-manager/shared/context-manager-base.ts',
        "import { logger } from 'src/agent/shared/logger';",
      ),
    ).toEqual([]);
  });
});

describe('baseline matching semantics', () => {
  it('matches violations by file plus import path, not line number', () => {
    const violation = violationFor(
      'src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts',
      42,
      "import { LlmCaller } from 'src/agent/runtime-kernel/llm/caller';",
      'AGENT-GUARD-07-no-host-deep-import',
    );

    const baseline = parseBaselineEntries([
      "src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts:7:import { LlmCaller } from 'src/agent/runtime-kernel/llm/caller';",
    ]);

    const result = partitionBaselineViolations([violation], baseline);

    expect(result.blocking).toEqual([]);
    expect(result.baselined).toEqual([violation]);
  });

  it('does not baseline a different import path from the same file', () => {
    const violation = violationFor(
      'src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts',
      43,
      "import { ModelResolver } from 'src/agent/runtime-kernel/llm/modelResolver';",
      'AGENT-GUARD-07-no-host-deep-import',
    );

    const baseline = parseBaselineEntries([
      "src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts:7:import { LlmCaller } from 'src/agent/runtime-kernel/llm/caller';",
    ]);

    const result = partitionBaselineViolations([violation], baseline);

    expect(result.blocking).toEqual([violation]);
    expect(result.baselined).toEqual([]);
  });
});

describe('AGENT-GUARD-10-no-testkit-in-production', () => {
  it('flags production source importing vitest', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/adapters/flow/flow.stream-handler.ts',
        "import { vi } from 'vitest';",
      ),
    ).toContain('AGENT-GUARD-10-no-testkit-in-production');
  });

  it('flags production source importing linnkit/testkit', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/adapters/flow/flow.stream-handler.ts',
        "import * as testkit from '@linnlabs/linnkit/testkit';",
      ),
    ).toContain('AGENT-GUARD-10-no-testkit-in-production');
  });

  it('flags production plugin code importing the Host test runtime', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/supplystrata/src/backend/index.ts',
        "import { installPluginHostTestRuntime } from '@plugin/backend/testRuntime';",
      ),
    ).toContain('AGENT-GUARD-10-no-testkit-in-production');
  });

  it('exempts files under a /testkit/ path segment', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/testkit/agent-harness/childRunHarness.ts',
        "import * as testkit from '@linnlabs/linnkit/testkit';",
      ),
    ).not.toContain('AGENT-GUARD-10-no-testkit-in-production');
  });

  it('exempts vitest.config.ts', () => {
    expect(
      ruleIdsFor(
        'vitest.config.ts',
        "import { defineConfig } from 'vitest/config';",
      ),
    ).toEqual([]);
  });
});

describe('AGENT-GUARD-12-no-legacy-linnkit-import', () => {
  it('拒绝旧 linnkit bare import', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts',
        "import { GraphExecutor } from 'linnkit/runtime-kernel';",
      ),
    ).toContain('AGENT-GUARD-12-no-legacy-linnkit-import');
  });

  it('允许正式 @linnlabs/linnkit 子入口', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts',
        "import { GraphExecutor } from '@linnlabs/linnkit/runtime-kernel';",
      ),
    ).not.toContain('AGENT-GUARD-12-no-legacy-linnkit-import');
  });
});

describe('PLUGIN-CONTRACT-01-no-host-internal-import', () => {
  it('flags host source imports from the plugin host contract package', () => {
    expect(
      ruleIdsFor(
        'packages/plugin-host-contract/backend/pluginContribution.ts',
        "import type { PluginRegistryEntry } from 'src/app-hosts/linnya/plugin-registry/types';",
      ),
    ).toContain('PLUGIN-CONTRACT-01-no-host-internal-import');
  });

  it('allows independent package contracts', () => {
    expect(
      ruleIdsFor(
        'packages/plugin-host-contract/backend/pluginContribution.ts',
        "import type { PluginMeta } from '@app/schemas';",
      ),
    ).toEqual([]);
  });

  it('allows local contract modules', () => {
    expect(
      ruleIdsFor(
        'packages/plugin-host-contract/backend/index.ts',
        "export type * from './pluginContribution';",
      ),
    ).toEqual([]);
  });
});

describe('AGENT-GUARD-11-no-context-shared-profile-import', () => {
  it('flags shared context-manager files importing profile internals', () => {
    expect(
      ruleIdsFor(
        'packages/linnkit/src/context-manager/shared/MessageFormatter.ts',
        "import type { ChatMessage } from '../profiles/chat/contracts';",
      ),
    ).toContain('AGENT-GUARD-11-no-context-shared-profile-import');
  });

  it('allows profile files importing shared code', () => {
    expect(
      ruleIdsFor(
        'packages/linnkit/src/context-manager/profiles/chat/contracts.ts',
        "import type { ChatMessage } from '../../shared/contracts/chatLineMessage';",
      ),
    ).not.toContain('AGENT-GUARD-11-no-context-shared-profile-import');
  });
});

describe('PLUGIN-GUARD-03/04 ToolContext derivation', () => {
  it('flags naked ToolContext spread in production tools', () => {
    const violations = analyzeSourceText(
      'src/tools/workspace/write_file/WriteFileTool.ts',
      [
        'import type { ToolContext } from "../../types";',
        'function derive(context: ToolContext) {',
        '  return { ...context, workspaceService: {} };',
        '}',
      ].join('\n'),
    );

    expect(violations.map((violation) => violation.ruleId)).toContain(
      'PLUGIN-GUARD-03-no-naked-toolcontext-spread',
    );
  });

  it('flags workspaceService fallback that bypasses plugin-aware derivation', () => {
    const violations = analyzeSourceText(
      'src/tools/workspace/write_file/WriteFileTool.ts',
      [
        'import { WorkspaceService } from "../../electron-main/services/workspace/workspace";',
        'function run(context: ToolContext, db: unknown) {',
        '  const workspaceService = context.workspaceService ?? new WorkspaceService(db);',
        '  return workspaceService;',
        '}',
      ].join('\n'),
    );

    expect(violations.map((violation) => violation.ruleId)).toContain(
      'PLUGIN-GUARD-04-no-workspace-service-fallback-in-tools',
    );
  });

  it('allows the single workspace tool context derivation entry to create WorkspaceService', () => {
    const violations = analyzeSourceText(
      'src/tools/workspace/shared/workspaceToolContext.ts',
      [
        'import { WorkspaceService } from "../../../electron-main/services/workspace/workspace";',
        'export function ensure(context: ToolContext) {',
        '  return { workspaceService: new WorkspaceService(context.databaseService.getDb()) };',
        '}',
      ].join('\n'),
    );

    expect(violations).toEqual([]);
  });
});

describe('PLUGIN-GUARD-05 plugin IPC contribution', () => {
  it('flags official plugin backend entries using split legacy IPC fields', () => {
    const violations = analyzeSourceText(
      'packages/plugins/slides/src/backend/index.ts',
      [
        'export const slidesBackendPlugin = {',
        "  ipcChannels: ['slides:preview'],",
        '  ipcRegistrars: [registerSlidesIpcHandlers],',
        '} satisfies PluginBackendContribution;',
      ].join('\n'),
    );

    expect(violations.map((violation) => violation.ruleId)).toEqual([
      'PLUGIN-GUARD-05-no-legacy-ipc-contribution-fields',
      'PLUGIN-GUARD-05-no-legacy-ipc-contribution-fields',
    ]);
  });

  it('allows the single atomic IPC contribution field', () => {
    const violations = analyzeSourceText(
      'packages/plugins/mindmap/src/backend/index.ts',
      [
        'export const mindmapBackendPlugin = {',
        '  ipc: {',
        "    channels: ['mindmap-document:read'],",
        '    register(serviceManager, registrar) { registrar("mindmap", "mindmap-document:read", async () => ({})); },',
        '  },',
        '} satisfies PluginBackendContribution;',
      ].join('\n'),
    );

    expect(violations).toEqual([]);
  });
});

describe('PLUGIN-GUARD-06 plugin database migrations', () => {
  it('flags official plugin backend entries declaring schemaProviders', () => {
    const violations = analyzeSourceText(
      'packages/plugins/mindmap/src/backend/index.ts',
      [
        'export const mindmapBackendPlugin = {',
        '  schemaProviders: [new MindMapDocumentSchemaProvider()],',
        '  pluginMigrations: mindmapPluginMigrations,',
        '} satisfies PluginBackendContribution;',
      ].join('\n'),
    );

    expect(violations.map((violation) => violation.ruleId)).toEqual([
      'PLUGIN-GUARD-06-no-plugin-schema-providers',
    ]);
  });

  it('allows pluginMigrations as the single plugin DDL entry', () => {
    const violations = analyzeSourceText(
      'packages/plugins/slides/src/backend/index.ts',
      [
        'export const slidesBackendPlugin = {',
        '  ownedTables: SLIDES_OWNED_TABLES,',
        '  pluginMigrations: slidesPluginMigrations,',
        '} satisfies PluginBackendContribution;',
      ].join('\n'),
    );

    expect(violations).toEqual([]);
  });
});

describe('PLUGIN-GUARD-08 SDK plugin contribution ownership', () => {
  it('flags backend SDK contribution contract importing host registry types', () => {
    expect(
      ruleIdsFor(
        'src/plugin-sdk/backend/pluginContribution.ts',
        "export type { PluginBackendContribution } from 'src/app-hosts/linnya/plugin-registry/types';",
      ),
    ).toContain('PLUGIN-GUARD-08-no-sdk-plugin-contribution-host-registry-types');
  });

  it('flags relative imports from backend SDK contribution contract to host registry types', () => {
    expect(
      ruleIdsFor(
        'src/plugin-sdk/backend/pluginContribution.ts',
        "import type { PluginBackendContribution } from '../../app-hosts/linnya/plugin-registry/types';",
      ),
    ).toContain('PLUGIN-GUARD-08-no-sdk-plugin-contribution-host-registry-types');
  });

  it('allows the host registry compatibility entry to implement the SDK contract', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/plugin-registry/types.ts',
        "import type { PluginBackendContribution } from '../../../plugin-sdk/backend/pluginContribution';",
      ),
    ).toEqual([]);
  });
});

describe('PLUGIN-GUARD-09 renderer SDK plugin contribution ownership', () => {
  it('flags renderer SDK contribution contract importing renderer host plugin types', () => {
    expect(
      ruleIdsFor(
        'src/plugin-sdk/renderer/pluginContribution.ts',
        "export type { RendererPluginContribution } from '@/app/plugins/types';",
      ),
    ).toContain('PLUGIN-GUARD-09-no-renderer-sdk-plugin-contribution-host-types');
  });

  it('allows the renderer host compatibility entry to implement the SDK contract', () => {
    expect(
      ruleIdsFor(
        'apps/renderer/app/plugins/types.ts',
        "import type { RendererPluginContribution } from 'src/plugin-sdk/renderer/pluginContribution';",
      ),
    ).toEqual([]);
  });
});

describe('PLUGIN-GUARD-10 renderer SDK port ownership', () => {
  it('flags renderer SDK ports importing host domains directly', () => {
    expect(
      ruleIdsFor(
        'src/plugin-sdk/renderer/interactiveTool.ts',
        "import { useAssistantStore } from '@/domains/conversation/store/assistantStore';",
      ),
    ).toContain('PLUGIN-GUARD-10-no-renderer-sdk-port-host-domain-import');
  });

  it('flags renderer SDK ports importing host shared composables directly', () => {
    expect(
      ruleIdsFor(
        'src/plugin-sdk/renderer/referenceRuntime.ts',
        "import { useWebManualCitationForm } from '@/shared/composables/useWebManualCitationForm';",
      ),
    ).toContain('PLUGIN-GUARD-10-no-renderer-sdk-port-host-domain-import');
  });

  it('allows renderer host installers to import host domains when implementing SDK ports', () => {
    expect(
      ruleIdsFor(
        'apps/renderer/app/plugins/builtin/installBuiltinRendererPluginPorts.ts',
        "import { useAssistantStore } from '@/domains/conversation/store/assistantStore';",
      ),
    ).toEqual([]);
  });
});

describe('PLUGIN-GUARD-11 plugin renderer CSS lifecycle', () => {
  it('forbids official plugin renderer entry CSS side-effect imports', () => {
    expect(
      sourceRuleIdsFor(
        'packages/plugins/slides/src/renderer/index.ts',
        "import './page/SlidesPage.css';",
      ),
    ).toContain('PLUGIN-GUARD-11-no-plugin-renderer-css-side-effect-import');
  });

  it('allows official plugin renderer stylesheet URL imports', () => {
    expect(
      sourceRuleIdsFor(
        'packages/plugins/slides/src/renderer/index.ts',
        "import slidesPageStylesheet from './page/SlidesPage.css?url';",
      ),
    ).not.toContain('PLUGIN-GUARD-11-no-plugin-renderer-css-side-effect-import');
  });

  it('allows internal renderer implementation modules to own package-local CSS side effects', () => {
    expect(
      sourceRuleIdsFor(
        'packages/plugins/sheet/src/renderer/domain/engine/action-recorder/src/index.ts',
        "import './global.css';",
      ),
    ).not.toContain('PLUGIN-GUARD-11-no-plugin-renderer-css-side-effect-import');
  });
});

describe('PLUGIN-GUARD-12 renderer plugin CSS ownership', () => {
  it('flags Slides tool card CSS imports from host conversation styles', () => {
    expect(
      sourceRuleIdsFor(
        'apps/renderer/domains/conversation/styles/components/index.css',
        "@import './PresentationActionCard.css';",
      ),
    ).toContain('PLUGIN-GUARD-12-no-slides-tool-card-css-in-host-conversation');
  });

  it('allows Slides renderer contribution to register card CSS as plugin stylesheet URLs', () => {
    expect(
      sourceRuleIdsFor(
        'packages/plugins/slides/src/renderer/index.ts',
        "import presentationActionCardStylesheet from './tool-cards/styles/PresentationActionCard.css?url';",
      ),
    ).not.toContain('PLUGIN-GUARD-12-no-slides-tool-card-css-in-host-conversation');
  });
});

describe('PLUGIN-GUARD-13 renderer shell contribution ownership', () => {
  it('flags app layout branching on plugin document type names', () => {
    expect(
      sourceRuleIdsFor(
        'apps/renderer/app/layout/AppLayout.vue',
        ":class=\"{ 'for-mindmap': shellDocumentType === 'mindmap' }\"",
      ),
    ).toContain('PLUGIN-GUARD-13-no-plugin-type-branch-in-app-layout');
  });

  it('flags plugin document shell styles in host editor shell CSS', () => {
    expect(
      sourceRuleIdsFor(
        'apps/renderer/app/layout/styles/editor-shell.css',
        '.editor-shell.for-sheet { overflow: hidden; }',
      ),
    ).toContain('PLUGIN-GUARD-13-no-plugin-type-branch-in-app-layout');
  });

  it('flags plugin document surface styles in host DocumentSurface CSS', () => {
    expect(
      sourceRuleIdsFor(
        'apps/renderer/app/layout/styles/components/DocumentSurface.css',
        '.document-surface--slides { display: flex; }',
      ),
    ).toContain('PLUGIN-GUARD-13-no-plugin-type-branch-in-app-layout');
  });

  it('allows plugins to declare their shell class in document type contribution', () => {
    expect(
      sourceRuleIdsFor(
        'packages/plugins/mindmap/src/renderer/index.ts',
        "shellClass: 'for-mindmap',",
      ),
    ).not.toContain('PLUGIN-GUARD-13-no-plugin-type-branch-in-app-layout');
  });
});

describe('PLUGIN-GUARD-14 document reference labels', () => {
  it('flags host conversation reference UI hardcoding mindmap runtime lookup', () => {
    expect(
      sourceRuleIdsFor(
        'apps/renderer/domains/conversation/ui/tools/shared/WorkspaceRefLink.vue',
        "return getDocumentReferenceRuntimeHandler('mindmap')?.getCurrentDocumentId() ?? null",
      ),
    ).toContain('PLUGIN-GUARD-14-no-mindmap-reference-label-in-host-conversation');
  });

  it('allows the MindMap plugin to own its reference label', () => {
    expect(
      sourceRuleIdsFor(
        'packages/plugins/mindmap/src/renderer/ports/registerMindmapRendererPorts.ts',
        "referenceLabel: '节点引用',",
      ),
    ).not.toContain('PLUGIN-GUARD-14-no-mindmap-reference-label-in-host-conversation');
  });
});

describe('PLUGIN-GUARD-15/16 conversation document interaction contract', () => {
  it('flags host conversation reintroducing the MindMap reference resolver wrapper', () => {
    expect(
      sourceRuleIdsFor(
        'apps/renderer/domains/conversation/ui/shared/workspaceReferenceResolver.ts',
        "export function resolveMindMapReferenceInDocument(documentId: string, ref: string) { return null; }",
      ),
    ).toContain('PLUGIN-GUARD-15-no-mindmap-reference-resolver-wrapper');
  });

  it('flags host workspace read card parsing plugin private NodeRef text', () => {
    expect(
      sourceRuleIdsFor(
        'apps/renderer/domains/conversation/ui/tools/workspace/WorkspaceDocumentViewCard.vue',
        "function parseDocumentOutlineFromPlainBody(body: string) { return []; }",
      ),
    ).toContain('PLUGIN-GUARD-16-no-outline-private-text-parsing-in-host-conversation');
  });

  it('allows plugins to own their private NodeRef text format', () => {
    expect(
      sourceRuleIdsFor(
        'packages/plugins/mindmap/src/backend/tools/mindmap/read/mindmapNodeRefViewBuilder.ts',
        "lines.push(`[#ABC123] ${topic} (Root) ⟦tag⟧`);",
      ),
    ).not.toContain('PLUGIN-GUARD-16-no-outline-private-text-parsing-in-host-conversation');
  });
});

describe('MINDMAP-PKG-01-no-host-internal-import', () => {
  const includeMindmapPackageRules = { includeMindmapPackageRules: true } as const;

  it('flags package production code importing host internals', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/mindmap/src/backend/tools/example.ts',
        "import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';",
        includeMindmapPackageRules,
      ),
    ).toContain('MINDMAP-PKG-01-no-host-internal-import');
  });

  it('flags package production code importing renderer app aliases', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/mindmap/src/renderer/index.ts',
        "import MindmapPage from '@/app/pages/MindmapPage/MindmapPage.vue';",
        includeMindmapPackageRules,
      ),
    ).toContain('MINDMAP-PKG-01-no-host-internal-import');
  });

  it('allows package code importing host plugin SDK ports', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/mindmap/src/backend/documentTypeHook.ts',
        "import type { DocumentTypeBackendHook } from '@plugin/backend/documentTypeBackendHook';",
        includeMindmapPackageRules,
      ),
    ).not.toContain('MINDMAP-PKG-01-no-host-internal-import');
  });

  it('allows package code importing the app localization facade', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/mindmap/src/renderer/domain/orchestration/registerLocalization.ts',
        "import { registerMessageCatalogs } from '@app/localization';",
        includeMindmapPackageRules,
      ),
    ).not.toContain('MINDMAP-PKG-01-no-host-internal-import');
  });

  it('allows package-local relative imports', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/mindmap/src/backend/index.ts',
        "import { mindmapDocumentTypeHook } from './documentTypeHook';",
        includeMindmapPackageRules,
      ),
    ).not.toContain('MINDMAP-PKG-01-no-host-internal-import');
  });

  it('allows package code importing its own plugin manifest', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/mindmap/src/shared/pluginMeta.ts',
        "import manifestJson from '../../plugin.json';",
        includeMindmapPackageRules,
      ),
    ).not.toContain('MINDMAP-PKG-01-no-host-internal-import');
  });

  it('still flags package code importing arbitrary package-root files', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/mindmap/src/shared/pluginMeta.ts',
        "import readme from '../../README.md';",
        includeMindmapPackageRules,
      ),
    ).toContain('MINDMAP-PKG-01-no-host-internal-import');
  });
});

describe('MINDMAP-PKG-02-no-mindmap-package-deep-import', () => {
  const includeMindmapPackageRules = { includeMindmapPackageRules: true } as const;
  const mindmapRendererEntry = `@plugin/mindmap/${'renderer'}`;

  it('flags host code importing package source internals', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/plugin-registry/builtin/mindmap.backend.ts',
        "import { mindmapToolClasses } from 'packages/plugins/mindmap/src/backend/tools';",
        includeMindmapPackageRules,
      ),
    ).toContain('MINDMAP-PKG-02-no-mindmap-package-deep-import');
  });

  it('flags host code importing private @plugin/mindmap subpaths', () => {
    expect(
      ruleIdsFor(
        'apps/renderer/app/plugins/builtin/platform.renderer.ts',
        `import { MindmapPage } from '${mindmapRendererEntry}/page/MindmapPage';`,
        includeMindmapPackageRules,
      ),
    ).toContain('MINDMAP-PKG-02-no-mindmap-package-deep-import');
  });

  it('allows public package entries', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/mindmap/src/renderer/index.ts',
        `import { mindmapRendererPlugin } from '${mindmapRendererEntry}';`,
        includeMindmapPackageRules,
      ),
    ).not.toContain('MINDMAP-PKG-02-no-mindmap-package-deep-import');
  });

  it('flags host renderer code importing the concrete Mindmap renderer entry', () => {
    expect(
      ruleIdsFor(
        'apps/renderer/app/plugins/builtin/platform.renderer.ts',
        `import { mindmapRendererPlugin } from '${mindmapRendererEntry}';`,
        includeMindmapPackageRules,
      ),
    ).toContain('MINDMAP-PKG-08-no-host-renderer-plugin-entry-import');
  });
});

describe('MINDMAP-PKG-03-backend-entry-not-from-host', () => {
  const includeMindmapPackageRules = { includeMindmapPackageRules: true } as const;

  it('flags host code importing the Mindmap backend entry', () => {
    expect(
      ruleIdsFor(
        'src/tools/workspace/read_file/ReadFileTool.ts',
        "import { MindMapDocumentService } from '@plugin/mindmap/backend';",
        includeMindmapPackageRules,
      ),
    ).toContain('MINDMAP-PKG-03-backend-entry-not-from-host');
  });

  it('forbids Core from reviving a Mindmap backend glue', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/plugin-registry/builtin/mindmap.backend.ts',
        "import { mindmapBackendPlugin } from '@plugin/mindmap/backend';",
        includeMindmapPackageRules,
      ),
    ).toContain('MINDMAP-PKG-03-backend-entry-not-from-host');
  });
});

describe('MINDMAP-PKG backend public entry rules', () => {
  it('forbids reviving Mindmap persistence or tool exports in the public backend entry', () => {
    expect(sourceRuleIdsFor(
      'packages/plugins/mindmap/src/backend/index.ts',
      [
        "export { MindMapDocumentService } from './persistence/mindmap_document/services/mindmap_document.service';",
        "export { mindmapToolManifest } from './tools/mindmap';",
      ].join('\n'),
    )).toContain('MINDMAP-PKG-08-no-public-backend-persistence-export');

    expect(sourceRuleIdsFor(
      'packages/plugins/mindmap/src/backend/test-support.ts',
      [
        "export { MindMapDocumentService } from './persistence/mindmap_document/services/mindmap_document.service';",
      ].join('\n'),
    )).not.toContain('MINDMAP-PKG-08-no-public-backend-persistence-export');
  });
});

describe('SLIDES-PKG package rules', () => {
  const includeRuntimePluginPackageRules = { includeRuntimePluginPackageRules: true } as const;
  const slidesRendererEntry = `@plugin/slides/${'renderer'}`;

  it('flags Slides package production code importing host internals', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/slides/src/backend/engine/example.ts',
        "import { createPptCoordinator } from 'src/features/ai-ppt/application/createPptCoordinator';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-01-no-host-internal-import');
  });

  it('allows Slides package code importing its shared public entry', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/slides/src/backend/index.ts',
        "import { SLIDES_PLUGIN_META } from '@plugin/slides/shared';",
        includeRuntimePluginPackageRules,
      ),
    ).toEqual([]);
  });

  it('flags host code importing Slides package source internals', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/plugin-registry/builtin/slides.backend.ts',
        "import { slidesBackendPlugin } from 'packages/plugins/slides/src/backend/index';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-02-no-slides-package-deep-import');
  });

  it('flags host code importing private @plugin/slides subpaths', () => {
    expect(
      ruleIdsFor(
        'apps/renderer/app/plugins/builtin/platform.renderer.ts',
        `import { SlidesPage } from '${slidesRendererEntry}/page/SlidesPage';`,
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-02-no-slides-package-deep-import');
  });

  it('forbids Core from reviving a Slides backend glue', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/plugin-registry/builtin/slides.backend.ts',
        "import { slidesBackendPlugin } from '@plugin/slides/backend';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-03-backend-entry-not-from-host');
  });

  it('allows the explicit multi-plugin composition test layer to assemble backend entries', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/__tests__/workspaceVfsIntegration.test.ts',
        "import { slidesBackendPlugin } from '@plugin/slides/backend';",
        includeRuntimePluginPackageRules,
      ),
    ).not.toContain('SLIDES-PKG-03-backend-entry-not-from-host');
  });

  it('flags non-glue code importing the Slides backend entry', () => {
    expect(
      ruleIdsFor(
        'src/tools/presentation/LegacyPresentationTool.ts',
        "import { slidesBackendPlugin } from '@plugin/slides/backend';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-03-backend-entry-not-from-host');
  });

  it('flags host code importing the removed Slides backend engine barrel', () => {
    expect(
      ruleIdsFor(
        'src/features/ai-ppt/tools/seedDevPresentation.ts',
        "import type { SlidesEngineExecutionAdapter } from '@plugin/slides/backend-engine';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-02-no-slides-package-deep-import');
  });

  it('flags renderer code importing the removed Slides backend engine barrel', () => {
    expect(
      ruleIdsFor(
        'apps/renderer/app/plugins/builtin/platform.renderer.ts',
        "import type { SlidesEngineExecutionAdapter } from '@plugin/slides/backend-engine';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-02-no-slides-package-deep-import');
  });

  it('allows host backend code importing the Slides backend coordinator entry', () => {
    expect(
      ruleIdsFor(
        'src/features/ai-ppt/tools/seedDevPresentation.ts',
        "import { createPptCoordinator } from '@plugin/slides/backend-coordinator';",
        includeRuntimePluginPackageRules,
      ),
    ).toEqual([]);
  });

  it('allows repository guards importing the pure Slides CLI contract entry', () => {
    expect(
      ruleIdsFor(
        'scripts/codegen/slidesSkillContract.ts',
        "import { parseSlidesCliArgs } from '@plugin/slides/backend-cli-contract';",
        includeRuntimePluginPackageRules,
      ),
    ).toEqual([]);
  });

  it('flags host renderer code importing the concrete Slides renderer entry', () => {
    expect(
      ruleIdsFor(
        'apps/renderer/app/plugins/builtin/platform.renderer.ts',
        `export { slidesRendererPlugin } from '${slidesRendererEntry}';`,
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-08-no-host-renderer-plugin-entry-import');
  });

  it('flags renderer code importing the Slides backend coordinator entry', () => {
    expect(
      ruleIdsFor(
        'apps/renderer/app/plugins/builtin/platform.renderer.ts',
        "import { PptCoordinator } from '@plugin/slides/backend-coordinator';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-04-backend-entry-not-from-renderer');
  });

  it('allows host backend code importing the Slides backend IPC contract entry', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/slides/src/backend/ipc/registerSlidesIpcHandlers.ts',
        "import { parseSlidesGeneratePayload } from '@plugin/slides/backend-ipc';",
        includeRuntimePluginPackageRules,
      ),
    ).toEqual([]);
  });

  it('flags renderer code importing the Slides backend IPC contract entry', () => {
    expect(
      ruleIdsFor(
        'apps/renderer/app/plugins/builtin/platform.renderer.ts',
        "import { parseSlidesGeneratePayload } from '@plugin/slides/backend-ipc';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-04-backend-entry-not-from-renderer');
  });

  it('allows package backend code importing the Slides backend sandbox entry', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/slides/src/backend/codegen/CodegenDeckBuilder.ts',
        "import { pptComposeProfile } from '@plugin/slides/backend-sandbox';",
        includeRuntimePluginPackageRules,
      ),
    ).toEqual([]);
  });

  it('flags renderer code importing the Slides backend sandbox entry', () => {
    expect(
      ruleIdsFor(
        'apps/renderer/app/plugins/builtin/platform.renderer.ts',
        "import { pptComposeProfile } from '@plugin/slides/backend-sandbox';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-04-backend-entry-not-from-renderer');
  });

  it('flags host backend production code importing the Slides backend tools entry', () => {
    expect(
      ruleIdsFor(
        'src/tools/presentation/legacyPresentationRunner.ts',
        "export type { PresentationToolCoordinatorPort } from '@plugin/slides/backend-tools';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-02-no-slides-package-deep-import');
  });

  it('flags renderer code importing the Slides backend tools contract entry', () => {
    expect(
      ruleIdsFor(
        'apps/renderer/app/plugins/builtin/platform.renderer.ts',
        "import type { PresentationToolCoordinatorPort } from '@plugin/slides/backend-tools';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-02-no-slides-package-deep-import');
  });

  it('allows host backend code importing the Slides backend tool classes entry', () => {
    expect(
      ruleIdsFor(
        'src/features/ai-ppt/tools/referenceChineseShowcase.ts',
        "import { PptPlanTool } from '@plugin/slides/backend-tool-classes';",
        includeRuntimePluginPackageRules,
      ),
    ).toEqual([]);
  });

  it('flags renderer code importing the Slides backend tool classes entry', () => {
    expect(
      ruleIdsFor(
        'apps/renderer/app/plugins/builtin/platform.renderer.ts',
        "import { PptPlanTool } from '@plugin/slides/backend-tool-classes';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-04-backend-entry-not-from-renderer');
  });

  it('forbids importing the removed Slides backend persistence public entry', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/slides/src/backend/persistence/presentation-repository-fixture.ts',
        "import { PresentationRepository } from '@plugin/slides/backend-persistence';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-07-no-backend-persistence-public-entry');

    expect(
      ruleIdsFor(
        'src/features/ai-ppt/infrastructure/sqlite/PresentationRepository.ts',
        "export { PresentationRepository } from '@plugin/slides/backend-persistence';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-07-no-backend-persistence-public-entry');

    expect(
      ruleIdsFor(
        'src/tools/presentation/LegacyPresentationTool.ts',
        "import { PresentationRepository } from '@plugin/slides/backend-persistence';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-07-no-backend-persistence-public-entry');
  });

  it('forbids reviving the deleted Slides legacy backend bridge from anywhere', () => {
    // 5BB：过渡桥文件已删除，任何位置（含插件包装配点、host resolver、测试）import 都违规。
    expect(
      ruleIdsFor(
        'packages/plugins/slides/src/backend/index.ts',
        "import { decorateSlidesToolContext } from '@plugin/backend/slidesLegacyBackend';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-05-legacy-backend-bridge-restricted');

    expect(
      ruleIdsFor(
        'packages/plugins/slides/src/backend/ipc/registerSlidesIpcHandlers.ts',
        "import { createSlidesIpcCoordinator } from '@plugin/backend/slidesLegacyBackend';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-05-legacy-backend-bridge-restricted');

    expect(
      ruleIdsFor(
        'src/tools/presentation/LegacyPresentationTool.ts',
        "import { presentationToolClasses } from 'src/plugin-sdk/backend/slidesLegacyBackend';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-05-legacy-backend-bridge-restricted');

    expect(
      ruleIdsFor(
        'packages/plugins/mindmap/src/backend/index.ts',
        "import { presentationToolClasses } from '@plugin/backend/slidesLegacyBackend';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-05-legacy-backend-bridge-restricted');

    expect(
      ruleIdsFor(
        'src/electron-main/plugins/loader/backendHostModuleResolver.ts',
        "import * as slidesLegacyBackend from '../../../plugin-sdk/backend/slidesLegacyBackend';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-05-legacy-backend-bridge-restricted');
  });

  it('flags production code importing old Slides host runtime islands', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/plugin-registry/builtin/slides.backend.ts',
        "import { createPptCoordinator } from 'src/features/ai-ppt/application/createPptCoordinator';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-06-no-host-legacy-runtime-import');

    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/adapters/tools/presentationToolRegistry.ts',
        "import { LegacyPresentationTool } from 'src/tools/presentation/LegacyPresentationTool';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-06-no-host-legacy-runtime-import');

    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/adapters/tools/presentationToolRegistry.ts',
        "import { LegacyPresentationTool } from '@tools/presentation/LegacyPresentationTool';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-06-no-host-legacy-runtime-import');

    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/plugin-registry/builtin/slides.backend.ts',
        "import { pptComposeProfile } from 'src/features/sandbox/profiles/pptComposeProfile';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-06-no-host-legacy-runtime-import');

    expect(
      ruleIdsFor(
        'apps/renderer/app/layout/orchestration/workspaceNavigation.ts',
        "import { useSlidesStore } from '@/domains/slides/store/slidesStore';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-06-no-host-legacy-runtime-import');

    expect(
      ruleIdsFor(
        'apps/renderer/app/plugins/builtin/platform.renderer.ts',
        "import SlidesView from '../../../domains/slides/ui/page/SlidesView.vue';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-06-no-host-legacy-runtime-import');
  });

  it('allows tests and plugin dev harness while host cleanup is still in progress', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/slides/src/backend/__tests__/ppt-coordinator.test.ts',
        "import { pptComposeProfile } from '@plugin/slides/backend-sandbox';",
        includeRuntimePluginPackageRules,
      ),
    ).toEqual([]);

    expect(
      ruleIdsFor(
        'packages/plugins/slides/dev/tools/seedDevPresentation.ts',
        "import type { DeckSpec } from '@plugin/slides/shared';",
        includeRuntimePluginPackageRules,
      ),
    ).toEqual([]);

    expect(
      ruleIdsFor(
        'apps/renderer/app/plugins/loader/runtimeRendererPluginLoader.ts',
        `import type { RendererPluginContribution } from '${slidesRendererEntry}';`,
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SLIDES-PKG-08-no-host-renderer-plugin-entry-import');
  });
});

describe('SHEET-PKG package rules', () => {
  const includeRuntimePluginPackageRules = { includeRuntimePluginPackageRules: true } as const;
  const sheetRendererEntry = `@plugin/sheet/${'renderer'}`;

  it('flags Sheet package production code importing host internals', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/sheet/src/backend/tools/example.ts',
        "import { SheetDocumentService } from 'src/features/workspace/infrastructure/sqlite/documents/sheet_document/services/sheet_document.service';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SHEET-PKG-01-no-host-internal-import');
  });

  it('allows Sheet package code importing its own public entries and SDK ports', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/sheet/src/backend/index.ts',
        "import { SHEET_PLUGIN_META } from '@plugin/sheet/shared';",
        includeRuntimePluginPackageRules,
      ),
    ).toEqual([]);

    expect(
      ruleIdsFor(
        'packages/plugins/sheet/src/backend/documentTypeHook.ts',
        "import type { DocumentTypeBackendHook } from '@plugin/backend/documentTypeBackendHook';",
        includeRuntimePluginPackageRules,
      ),
    ).toEqual([]);
  });

  it('flags host code importing Sheet package source internals', () => {
    expect(
      ruleIdsFor(
        'src/features/workspace/example.ts',
        "import { sheetToolManifest } from 'packages/plugins/sheet/src/backend/toolManifest';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SHEET-PKG-02-no-sheet-package-deep-import');
  });

  it('forbids Core from importing the Sheet backend entry', () => {
    expect(
      ruleIdsFor(
        'src/app-hosts/linnya/plugin-registry/builtin/sheet.backend.ts',
        "import { sheetBackendPlugin } from '@plugin/sheet/backend';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SHEET-PKG-03-backend-entry-not-from-host');

    expect(
      ruleIdsFor(
        'src/tools/sheet/tools/SheetWriteRangeTool.ts',
        "import { sheetBackendPlugin } from '@plugin/sheet/backend';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SHEET-PKG-03-backend-entry-not-from-host');
  });

  it('forbids reviving Sheet service or persistence exports in the public backend entry', () => {
    expect(sourceRuleIdsFor(
      'packages/plugins/sheet/src/backend/index.ts',
      [
        "export { SheetDocumentService } from './persistence/sheet_document/services/sheet_document.service';",
        "export { buildSheetWorkbookSnapshotForRead } from './persistence/sheet_document/services/sheet_document/readSnapshotForRead';",
      ].join('\n'),
    )).toContain('SHEET-PKG-08-no-public-backend-persistence-export');

    expect(sourceRuleIdsFor(
      'packages/plugins/sheet/src/backend/test-support.ts',
      [
        "export { SheetDocumentService } from './persistence/sheet_document/services/sheet_document.service';",
      ].join('\n'),
    )).not.toContain('SHEET-PKG-08-no-public-backend-persistence-export');
  });

  it('flags host renderer importing the concrete Sheet renderer entry', () => {
    expect(
      ruleIdsFor(
        'apps/renderer/app/plugins/builtin/platform.renderer.ts',
        `export { sheetRendererPlugin } from '${sheetRendererEntry}';`,
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SHEET-PKG-08-no-host-renderer-plugin-entry-import');
  });

  it('flags production code importing old Sheet renderer runtime islands', () => {
    expect(
      ruleIdsFor(
        'apps/renderer/app/pages/SheetPage/SheetPage.vue',
        "import { SheetWorkbench } from '@/domains/sheet';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SHEET-PKG-10-no-host-legacy-renderer-runtime-import');

    expect(
      ruleIdsFor(
        'apps/renderer/domains/workspace/services/file-manager/handlers/sheet.ts',
        "import { loadWorkbook } from '@/domains/sheet';",
        includeRuntimePluginPackageRules,
      ),
    ).toContain('SHEET-PKG-10-no-host-legacy-renderer-runtime-import');
  });
});

describe('SUPPLYSTRATA-PKG backend public entry rules', () => {
  it('forbids restoring a Host-side SupplyStrata backend source import', () => {
    expect(ruleIdsFor(
      'src/app-hosts/linnya/plugin-registry/builtin/private-plugin.backend.ts',
      "import { supplystrataBackendPlugin } from '@plugin/supplystrata/backend';",
      { includeRuntimePluginPackageRules: true },
    )).toContain('SUPPLYSTRATA-PKG-03-backend-entry-not-from-host');
  });

  it('forbids reviving SupplyStrata domain or tool exports in the public backend entry', () => {
    expect(sourceRuleIdsFor(
      'packages/plugins/supplystrata/src/backend/index.ts',
      [
        "export { SqliteDatabaseStore } from './persistence/functions/sqliteDatabaseStore';",
        "export * as supplystrataDocumentParser from './domain/document-parser';",
        "export { SupplystrataStartResearchTool } from './tools';",
      ].join('\n'),
    )).toContain('SUPPLYSTRATA-PKG-08-no-public-backend-persistence-export');

    expect(sourceRuleIdsFor(
      'packages/plugins/supplystrata/src/backend/test-support.ts',
      [
        "export { SqliteDatabaseStore } from './persistence/functions/sqliteDatabaseStore';",
      ].join('\n'),
    )).not.toContain('SUPPLYSTRATA-PKG-08-no-public-backend-persistence-export');
  });
});

describe('PLUGIN-GUARD-01-no-legacy-vfs-policy-import', () => {
  it('forbids importing the deleted hard-coded workspace VFS policy path', () => {
    expect(
      ruleIdsFor(
        'src/tools/workspace/read_file/ReadFileTool.ts',
        "import { pluginWorkspaceVfsNodeTypeAccessPolicy } from '../../../app-hosts/linnya/plugin-registry/workspaceVfsNodeAccessPolicy';",
      ),
    ).toContain('PLUGIN-GUARD-01-no-legacy-vfs-policy-import');

    expect(
      ruleIdsFor(
        'src/tools/workspace/read_file/ReadFileTool.ts',
        "import { pluginWorkspaceVfsNodeTypeAccessPolicy } from '../../../app-hosts/linnya/plugin-registry/pluginWorkspaceVfsNodeTypeAccessPolicy';",
      ),
    ).not.toContain('PLUGIN-GUARD-01-no-legacy-vfs-policy-import');
  });
});

describe('PLUGIN-GUARD-02-no-plugin-specific-runtime-access-in-workspace-runtime', () => {
  it('forbids consuming plugin-specific runtime gates through workspaceRuntime', () => {
    expect(
      ruleIdsFor(
        'packages/plugins/mindmap/src/backend/index.ts',
        "import { isMindmapPluginRuntimeEnabled } from '@plugin/backend/workspaceRuntime';",
      ),
    ).toContain('PLUGIN-GUARD-02-no-plugin-specific-runtime-access-in-workspace-runtime');

    expect(
      ruleIdsFor(
        'packages/plugins/mindmap/src/backend/index.ts',
        "import { isPluginRuntimeEnabled } from '@plugin/backend/pluginRuntime';",
      ),
    ).not.toContain('PLUGIN-GUARD-02-no-plugin-specific-runtime-access-in-workspace-runtime');
  });

  it('forbids re-exporting plugin-specific runtime gates from the generic workspace SDK', () => {
    expect(
      ruleIdsFor(
        'src/plugin-sdk/backend/workspaceRuntime.ts',
        "export { assertMindmapPluginRuntimeEnabled } from 'src/app-hosts/linnya/plugin-registry/mindmapPluginAccess';",
      ),
    ).toContain('PLUGIN-GUARD-02-no-plugin-specific-runtime-access-in-workspace-runtime');
  });
});

describe('PLUGIN-GUARD-07-no-static-agent-definition-snapshot-in-production', () => {
  it('forbids production code from importing the test-only all-agent snapshot', () => {
    const violations = analyzeSourceText(
      'src/tools/delegate/delegate.ts',
      "import { ALL_AGENT_DEFINITIONS_FOR_TESTS } from 'src/app-hosts/linnya/agent-registry/agents';",
    );

    expect(violations.map((violation) => violation.ruleId)).toContain(
      'PLUGIN-GUARD-07-no-static-agent-definition-snapshot-in-production',
    );
  });

  it('allows production code to use the runtime-gated resolver', () => {
    const violations = analyzeSourceText(
      'src/tools/delegate/delegate.ts',
      "import { listRegisteredAgentDefinitions } from 'src/app-hosts/linnya/agent-registry/agentDefinitionResolver';",
    );

    expect(violations.map((violation) => violation.ruleId)).not.toContain(
      'PLUGIN-GUARD-07-no-static-agent-definition-snapshot-in-production',
    );
  });
});

describe('PLUGIN-GUARD-17/18/19 plugin contract source', () => {
  const fixturePluginRoot = path.join(repoRoot, 'packages/plugins/__guard_fixture_plugin__');

  function writeFixturePlugin(): void {
    fs.rmSync(fixturePluginRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(fixturePluginRoot, 'host-types/backend'), { recursive: true });
    fs.writeFileSync(
      path.join(fixturePluginRoot, 'host-types/backend/workspaceRuntime.d.ts'),
      'export declare const WorkspaceService: unknown;\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(fixturePluginRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          paths: {
            '@plugin/backend/*': ['packages/plugins/__guard_fixture_plugin__/host-types/backend/*.d.ts'],
            '@plugin/renderer/*': ['packages/plugin-host-contract/renderer/*.ts'],
            '@app/localization': ['packages/plugin-host-contract/renderer/localization.ts'],
            '@/domains/*': ['apps/renderer/domains/*'],
          },
        },
      }, null, 2),
      'utf8',
    );
  }

  it('flags SDK mirror host-types and host-internal tsconfig paths', () => {
    try {
      writeFixturePlugin();

      const ruleIds = collectPluginContractGuardViolations().map((violation) => violation.ruleId);

      expect(ruleIds).toContain('PLUGIN-GUARD-17-no-plugin-host-types-mirror');
      expect(ruleIds).toContain('PLUGIN-GUARD-18-plugin-tsconfig-uses-host-contract');
      expect(ruleIds).toContain('PLUGIN-GUARD-19-no-plugin-tsconfig-host-internal-path');
    } finally {
      fs.rmSync(fixturePluginRoot, { recursive: true, force: true });
    }
  });
});

describe('extractImportsFromSource (AST-based scanner)', () => {
  it('extracts static, dynamic, type-only and re-export imports with correct lines', () => {
    const source = [
      "import a from 'mod-a';",
      "import { b } from 'mod-b';",
      "import * as c from 'mod-c';",
      "import type { d } from 'mod-d';",
      "import 'mod-e';",
      "export { x } from 'mod-f';",
      "export * from 'mod-g';",
      "const lazy = await import('mod-h');",
    ].join('\n');

    const imports = extractImportsFromSource('src/agent/example.ts', source);

    expect(imports).toEqual([
      { importPath: 'mod-a', line: 1, isStatic: true, preview: "import a from 'mod-a';" },
      { importPath: 'mod-b', line: 2, isStatic: true, preview: "import { b } from 'mod-b';" },
      { importPath: 'mod-c', line: 3, isStatic: true, preview: "import * as c from 'mod-c';" },
      { importPath: 'mod-d', line: 4, isStatic: true, preview: "import type { d } from 'mod-d';" },
      { importPath: 'mod-e', line: 5, isStatic: true, preview: "import 'mod-e';" },
      { importPath: 'mod-f', line: 6, isStatic: true, preview: "export { x } from 'mod-f';" },
      { importPath: 'mod-g', line: 7, isStatic: true, preview: "export * from 'mod-g';" },
      { importPath: 'mod-h', line: 8, isStatic: false, preview: "const lazy = await import('mod-h');" },
    ]);
  });

  it('ignores import-shaped strings that live inside line comments', () => {
    const source = [
      "// import { vi } from 'vitest';",
      "import { real } from 'real-mod';",
    ].join('\n');

    const imports = extractImportsFromSource('src/agent/example.ts', source);

    expect(imports.map((i) => i.importPath)).toEqual(['real-mod']);
  });

  it('ignores import-shaped strings that live inside block comments and JSDoc', () => {
    const source = [
      '/**',
      ' * Example usage:',
      " * `import { vi, expect } from 'vitest';`",
      " * import { Bad } from 'src/app-hosts/should-not-flag';",
      ' */',
      "import { real } from 'real-mod';",
      "/* import('@linnlabs/linnkit/testkit') */",
    ].join('\n');

    const imports = extractImportsFromSource('src/agent/example.ts', source);

    expect(imports.map((i) => i.importPath)).toEqual(['real-mod']);
  });

  it('ignores import-shaped strings that live inside string and template literals', () => {
    const source = [
      "const sample = `import { vi } from 'vitest';`;",
      "const msg = \"see: import { Bad } from 'src/app-hosts/x'\";",
      "import { real } from 'real-mod';",
    ].join('\n');

    const imports = extractImportsFromSource('src/agent/example.ts', source);

    expect(imports.map((i) => i.importPath)).toEqual(['real-mod']);
  });

  it('marks dynamic import() as non-static', () => {
    const source = "const m = await import('dyn-mod');";
    const imports = extractImportsFromSource('src/agent/example.ts', source);
    expect(imports).toEqual([
      { importPath: 'dyn-mod', line: 1, isStatic: false, preview: "const m = await import('dyn-mod');" },
    ]);
  });
});

describe('final enforce mode', () => {
  it('rejects non-empty reverse-import baseline files once PR-J is active', () => {
    const baseline = parseBaselineEntries([
      "src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts:7:import { LlmCaller } from 'src/agent/runtime-kernel/llm/caller';",
    ]);

    expect(
      validateDeepImportBaselineState(
        baseline,
        path.join(repoRoot, '.baseline/agent-deep-import-baseline.txt'),
      ),
    ).toContain('AGENT-GUARD-BASELINE-NOT-EMPTY');
  });

  it('accepts an empty reverse-import baseline file', () => {
    expect(
      validateDeepImportBaselineState(
        parseBaselineEntries([]),
        path.join(repoRoot, '.baseline/agent-deep-import-baseline.txt'),
      ),
    ).toBeNull();
  });

  it('allows non-empty baseline files when a temporary package migration guard opts in', () => {
    expect(
      validateDeepImportBaselineState(
        parseBaselineEntries([
          "packages/plugins/mindmap/src/backend/index.ts:1:import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';",
        ]),
        path.join(repoRoot, '.baseline/mindmap-package-boundary-baseline.txt'),
        false,
      ),
    ).toBeNull();
  });
});
