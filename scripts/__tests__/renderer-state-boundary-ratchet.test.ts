import { expect, test } from 'vitest';
import {
  findRendererStateEdges,
  compareRendererStateEdges,
} from '../guards/renderer-state-boundary-ratchet';

test('shared 运行值与 store 编排边受约束，类型和正常编排→store 不受阻', () => {
  expect(
    findRendererStateEdges(
      'apps/renderer/shared/stores/file.ts',
      'import { open } from "@/domains/workspace/services/file-manager";'
    )
  ).toHaveLength(1);
  expect(
    findRendererStateEdges(
      'apps/renderer/shared/port.ts',
      'import type { Model } from "@/domains/model-configuration";'
    )
  ).toEqual([]);
  expect(
    findRendererStateEdges(
      'apps/renderer/shared/port.ts',
      'import { type Model } from "@/domains/model-configuration";'
    )
  ).toEqual([]);
  expect(
    findRendererStateEdges(
      'apps/renderer/domains/x/store/state.ts',
      'import { load } from "../orchestration/load";'
    )
  ).toHaveLength(1);
  expect(
    findRendererStateEdges(
      'apps/renderer/domains/x/orchestration/load.ts',
      'import { useState } from "../store/state";'
    )
  ).toEqual([]);
});

test('新增失败、减少可收紧，不能以另一条新边抵消旧边减少', () => {
  expect(compareRendererStateEdges(['new'], ['old'])).toEqual({ added: ['new'], removed: ['old'] });
  expect(compareRendererStateEdges([], ['old'])).toEqual({ added: [], removed: ['old'] });
});

test('store 内直接实现异步流程也受约束，注释、类型与外部编排不误报', () => {
  const source = `// async function ignored() {}
type Loader = () => Promise<void>;
const useState = defineStore('x', () => {
  async function load() { await request(); }
  const retry = async () => load();
  return { load, retry, setValue(value) { state.value = value; } };
});`;
  const file = 'apps/renderer/domains/x/store/state.ts';
  expect(findRendererStateEdges(file, source)).toEqual([
    `STORE-ASYNC\t${file}\tload#1`, `STORE-ASYNC\t${file}\tretry#1`,
  ]);
  expect(findRendererStateEdges(file, `\n\n${source}`)).toEqual(findRendererStateEdges(file, source));
  expect(findRendererStateEdges('apps/renderer/domains/x/orchestration/load.ts', source)).toEqual([]);
});
