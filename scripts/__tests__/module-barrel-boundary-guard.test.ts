import { expect, test } from 'vitest';
import { findModuleBarrelViolations } from '../guards/module-barrel-boundary-guard';
import { readSourceImports } from '../source-analysis/readSourceImports';

test('模块回引会失败，直接引用定义/能力与外部公开入口可用', () => {
  const file = 'apps/renderer/domains/editor/features/BlockHistory/ui/History.vue';
  expect(
    findModuleBarrelViolations(file, '<script setup>import { useStore } from "../index";</script>')
  ).toHaveLength(1);
  expect(
    findModuleBarrelViolations(
      file,
      '<script setup>import { useStore } from "../store/useBlockHistoryStore";</script>'
    )
  ).toEqual([]);
  expect(
    findModuleBarrelViolations(
      'apps/renderer/domains/editor/ui/Editor.vue',
      '<script setup>import { HistoryOverlay } from "../features/BlockHistory";</script>'
    )
  ).toEqual([]);
  expect(
    findModuleBarrelViolations(
      'src/features/transcription/routes/router.ts',
      'export { service } from "@transcription";'
    )
  ).toHaveLength(1);
  expect(
    findModuleBarrelViolations(
      'packages/plugins/slides/src/backend/persistence/repositories/repository.ts',
      'import { decode } from "../../features/presentationSourceHistory/index.js";'
    )
  ).toHaveLength(1);
});

test('Revision 投影应用器只依赖状态，不能回引完整运行时', () => {
  const file = 'apps/renderer/domains/editor/features/Revision/utils/pending/apply.ts';
  expect(
    findModuleBarrelViolations(file, "import { useRevisionStore } from '../../useRevisionStore';")
  ).toHaveLength(1);
  expect(
    findModuleBarrelViolations(
      file,
      "import { getRevisionState } from '../../store/revisionState';"
    )
  ).toEqual([]);
});

test('插件 SDK 只查询已注册贡献，不带入加载器或 Desktop 装配', () => {
  const file = 'src/plugin-sdk/backend/pluginRendererPush.ts';
  expect(findModuleBarrelViolations(file,
    "import { query } from 'src/app-hosts/linnya/plugin-registry/builtin';")).toHaveLength(1);
  expect(findModuleBarrelViolations(file,
    "import { getPort } from '../../app-hosts/linnya/desktop-capabilities';")).toHaveLength(1);
  expect(findModuleBarrelViolations(file,
    "import { registry } from 'src/app-hosts/linnya/plugin-registry/registry';")).toEqual([]);
  expect(findModuleBarrelViolations(file,
    "import type { Port } from '../../app-hosts/linnya/desktop-capabilities';")).toEqual([]);
});

test('读模型和会话 handler 不能通过聚合入口加载对方 UI/装配', () => {
  expect(findModuleBarrelViolations(
    'apps/renderer/domains/conversation/features/subrun-card/ui/SubrunProgressCard.vue',
    '<script setup>import { KEY } from "../../subrun-detail";</script>',
  )).toHaveLength(1);
  expect(findModuleBarrelViolations(
    'apps/renderer/domains/workspace/services/file-manager/handlers/markdown.ts',
    'import { throwIfFileSessionOpenCancelled } from "../index";',
  )).toHaveLength(1);
  expect(findModuleBarrelViolations(
    'apps/renderer/domains/workspace/services/file-manager/handlers/markdown.ts',
    'import { throwIfFileSessionOpenCancelled } from "../functions/fileSessionCancellation";',
  )).toEqual([]);
});

test('Vue script 原行号与值/类型边正确识别，不把注释、字面量当依赖', () => {
  expect(
    readSourceImports(
      'View.vue',
      `<template>import Fake from 'fake'</template>
<script setup lang="ts">
// import Bad from 'bad';
import type { A } from 'types';
import { type B } from 'more-types';
import { type C, run } from 'runtime';
const text = "import Bad from 'string'";
const load = () => import('lazy');
</script>`
    )
  ).toEqual([
    { specifier: 'types', typeOnly: true, line: 4 },
    { specifier: 'more-types', typeOnly: true, line: 5 },
    { specifier: 'runtime', typeOnly: false, line: 6 },
    { specifier: 'lazy', typeOnly: false, line: 8 },
  ]);
});

 test('Conversation 编排使用投影命令叶子入口，UI 可以使用公开动作入口', () => {
  expect(findModuleBarrelViolations('apps/renderer/domains/conversation/services/orchestration/flow.ts', 'import { useConversationProjectionActions } from "../../assistantActions";')).toHaveLength(1);
  expect(findModuleBarrelViolations('apps/renderer/domains/conversation/services/orchestration/flow.ts', 'import { useConversationProjectionActions } from "../../projectionActions";')).toEqual([]);
  expect(findModuleBarrelViolations('apps/renderer/domains/conversation/ui/View.vue', 'import { cancelAssistantActivity } from "../assistantActions";')).toEqual([]);
 });
