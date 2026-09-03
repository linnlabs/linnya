import path from 'node:path';
import { describe, expect, it } from 'vitest';
import typescript from 'typescript';

import type {
  SlidesTypeScriptCreateRequire,
  SlidesTypeScriptRuntime,
  SlidesTypeScriptRuntimeRequire,
} from '../definitions/typescriptRuntime.js';
import { readSlidesTypeScriptRuntime } from './readTypeScriptRuntime.js';

function runtimeFixture(): SlidesTypeScriptRuntime {
  return typescript;
}

describe('readSlidesTypeScriptRuntime', () => {
  it('从 backend artifact 的本地 node_modules 读取 runtime', () => {
    const runtime = runtimeFixture();
    const requestedIds: string[] = [];
    const cjsRequire: SlidesTypeScriptRuntimeRequire = id => {
      requestedIds.push(id);
      return runtime;
    };

    expect(readSlidesTypeScriptRuntime({ cjsRequire })).toBe(runtime);
    expect(requestedIds).toEqual(['./node_modules/typescript']);
  });

  it('source-development 只以 Slides package.json 为解析锚点', () => {
    const runtime = runtimeFixture();
    const createRequireBases: Array<string | URL> = [];
    const requestedIds: string[] = [];
    const createRequireFactory: SlidesTypeScriptCreateRequire = filename => {
      createRequireBases.push(filename);
      return id => {
        requestedIds.push(id);
        return runtime;
      };
    };

    expect(
      readSlidesTypeScriptRuntime({
        cjsRequire: null,
        cwd: '/workspace',
        createRequireFactory,
      })
    ).toBe(runtime);
    expect(createRequireBases).toEqual([
      path.resolve('/workspace', 'packages/plugins/slides/package.json'),
    ]);
    expect(requestedIds).toEqual(['typescript']);
  });

  it('拒绝缺少 compiler API 的错误制品', () => {
    expect(() =>
      readSlidesTypeScriptRuntime({
        cjsRequire: () => ({ createSourceFile() {} }),
      })
    ).toThrowError('Slides TypeScript runtime 未提供完整的 compiler API。');
  });
});
