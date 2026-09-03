import fs from 'node:fs';
import path from 'node:path';

import type {
  DesktopHiddenWorkerDescriptor,
} from '../../../app-hosts/linnya/desktop-capabilities';

export interface HiddenWorkerArtifactAdmission {
  assertDescriptorAllowed(descriptor: DesktopHiddenWorkerDescriptor): void;
}

/**
 * Hidden worker 会让 Chromium 加载 HTML 与 preload，因此不能只校验“绝对路径”。
 * 两个文件必须真实存在，并且解析 symlink 后仍同时落在同一个已批准插件根目录内。
 */
export function createHiddenWorkerArtifactAdmission(
  allowedRoots: readonly string[],
): HiddenWorkerArtifactAdmission {
  const roots = normalizeExistingRoots(allowedRoots);
  if (roots.length === 0) throw new Error('Hidden worker 缺少可用的插件 artifact 根目录');

  return Object.freeze({
    assertDescriptorAllowed(descriptor: DesktopHiddenWorkerDescriptor) {
      const workerHtmlPath = resolveArtifactFile(descriptor.workerHtmlPath, '.html');
      const preloadPath = resolvePreloadFile(descriptor.preloadPath);
      const owningRoot = roots.find(root => (
        isInsideRoot(root, workerHtmlPath) && isInsideRoot(root, preloadPath)
      ));
      if (!owningRoot) {
        throw new Error(`Hidden worker ${descriptor.id} 的 artifact 不在同一个已批准插件目录内`);
      }
    },
  });
}

function normalizeExistingRoots(values: readonly string[]): readonly string[] {
  const roots = values
    .filter(value => path.isAbsolute(value) && fs.existsSync(value))
    .map(value => fs.realpathSync(value))
    .filter(value => fs.statSync(value).isDirectory());
  return Object.freeze([...new Set(roots)]);
}

function resolveArtifactFile(value: string, extension: string): string {
  if (!path.isAbsolute(value) || path.extname(value).toLowerCase() !== extension) {
    throw new Error(`Hidden worker artifact 必须是绝对 ${extension} 文件`);
  }
  const resolved = fs.realpathSync(value);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error('Hidden worker artifact 必须是非空普通文件');
  }
  return resolved;
}

function resolvePreloadFile(value: string): string {
  const extension = path.extname(value).toLowerCase();
  if (extension !== '.js' && extension !== '.cjs') {
    throw new Error('Hidden worker preload 必须是 .js 或 .cjs 文件');
  }
  return resolveArtifactFile(value, extension);
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}
