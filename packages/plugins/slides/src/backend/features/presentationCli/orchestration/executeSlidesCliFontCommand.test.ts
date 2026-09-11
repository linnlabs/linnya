import { describe, expect, it, vi } from 'vitest';
import { FontCatalogUnavailableError } from '@plugin/backend/fontResolution';

import {
  SlidesCliExitCode,
  type SlidesCliFontExecutionPort,
} from '../definitions/slidesCli';
import { executeSlidesCliFontCommand } from './executeSlidesCliFontCommand';

function createPort(): SlidesCliFontExecutionPort {
  return {
    checkFontFamily: vi.fn(async (family) => ({
      requestedFamily: family,
      installed: true,
      match: {
        family,
        scripts: ['latin'],
        styles: ['regular', 'bold'],
        monospace: false,
      },
    })),
    listFontFamilies: vi.fn(async (request) => ({
      ...request,
      total: 1,
      hasMore: false,
      families: [{
        family: 'Local Sans',
        scripts: ['latin'],
        styles: ['regular'],
        monospace: false,
      }],
    })),
  };
}

describe('executeSlidesCliFontCommand', () => {
  it('精确检查输出稳定 JSON 报告', async () => {
    const result = await executeSlidesCliFontCommand({
      kind: 'fonts-check',
      family: 'Georgia',
    }, createPort());

    expect(result.exitCode).toBe(SlidesCliExitCode.SUCCESS);
    expect(JSON.parse(result.stdout)).toEqual({
      kind: 'linnya.slides.font-check',
      schemaVersion: 1,
      cliVersion: '1.9.0',
      requestedFamily: 'Georgia',
      installed: true,
      match: {
        family: 'Georgia',
        scripts: ['latin'],
        styles: ['regular', 'bold'],
        monospace: false,
      },
    });
    expect(result.stderr).toBe('');
  });

  it('候选发现输出分页事实且不包含实现路径', async () => {
    const result = await executeSlidesCliFontCommand({
      kind: 'fonts-list',
      request: { script: 'latin', offset: 0, limit: 30 },
    }, createPort());

    const report = JSON.parse(result.stdout);
    expect(report.kind).toBe('linnya.slides.font-list');
    expect(report.families).toHaveLength(1);
    expect(report.hasMore).toBe(false);
    expect(result.stdout).not.toContain('filePath');
    expect(result.stdout).not.toContain('/fonts/');
  });

  it('字体目录失败时返回稳定错误，不泄漏扫描细节', async () => {
    const port = createPort();
    port.listFontFamilies = vi.fn(async () => {
      throw new FontCatalogUnavailableError();
    });

    const result = await executeSlidesCliFontCommand({
      kind: 'fonts-list',
      request: { script: 'latin', offset: 0, limit: 30 },
    }, port);

    expect(result).toEqual({
      exitCode: SlidesCliExitCode.ENVIRONMENT_UNAVAILABLE,
      stdout: '',
      stderr: 'slides.cli.font_catalog_unavailable: System font catalog is unavailable\n',
    });
  });

  it('未知实现错误使用 internal error，不伪装成目录扫描失败', async () => {
    const port = createPort();
    port.checkFontFamily = vi.fn(async () => {
      throw new TypeError('unexpected implementation bug');
    });

    const result = await executeSlidesCliFontCommand({
      kind: 'fonts-check',
      family: 'Georgia',
    }, port);

    expect(result).toEqual({
      exitCode: SlidesCliExitCode.INTERNAL_ERROR,
      stdout: '',
      stderr: 'slides.cli.internal_error: Font query failed unexpectedly\n',
    });
  });
});
