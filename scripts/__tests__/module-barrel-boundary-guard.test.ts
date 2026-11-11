import { expect, test } from 'vitest';
import { findModuleBarrelViolations } from '../guards/module-barrel-boundary-guard';
import { readSourceImports } from '../guards/functions/readSourceImports';

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
