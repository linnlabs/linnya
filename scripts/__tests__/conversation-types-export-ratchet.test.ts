import { describe, expect, it } from 'vitest';

import {
  compareExportSurface,
  readExportedSymbols,
  runConversationTypesExportRatchet,
} from '../guards/conversation-types-export-ratchet';

describe('Conversation legacy types export ratchet', () => {
  it('当前历史出口与 baseline 精确一致', () => {
    expect(runConversationTypesExportRatchet()).toEqual({ added: [], removed: [] });
  });

  it('按公开符号而不是 export 行数读取声明与 re-export block', () => {
    const source = [
      "export type { Alpha, Internal as PublicAlias } from './contracts';",
      'export interface Beta {}',
      'export type Gamma = string;',
      'export const Delta = 1, Epsilon = 2;',
    ].join('\n');

    expect(readExportedSymbols(source)).toEqual([
      'Alpha',
      'Beta',
      'Delta',
      'Epsilon',
      'Gamma',
      'PublicAlias',
    ]);
  });

  it('新增和删除分别形成扩张违规与 baseline 收紧信号', () => {
    expect(compareExportSurface(['Existing', 'NewType'], ['Existing'])).toEqual({
      added: ['NewType'],
      removed: [],
    });
    expect(compareExportSurface(['Existing'], ['Existing', 'Migrated'])).toEqual({
      added: [],
      removed: ['Migrated'],
    });
  });

  it('拒绝隐式与默认导出，避免公开面绕过命名集合', () => {
    expect(() => readExportedSymbols("export * from './contracts';"))
      .toThrow('禁止 export *');
    expect(() => readExportedSymbols('export default class Legacy {}'))
      .toThrow('禁止 default export');
    expect(() => readExportedSymbols('const legacy = {}; export default legacy;'))
      .toThrow('禁止 default export');
  });
});
