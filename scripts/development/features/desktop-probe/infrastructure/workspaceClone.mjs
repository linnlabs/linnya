import { constants, cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { ProbeError, repoRoot } from '../definitions/probeContract.mjs';

// 大体量结果、日志、缓存与运行锁不属于“用户数据”，克隆它们只会多出数万个文件。
const skippedRoots = new Set([
  'benchmark-results', 'ConversationWorkDirectories', 'logs', 'WebCache', 'SandboxRuns', 'branch-backups',
  'debug_images', 'app-server-renderer-requests', 'cli-runtime', 'font-resolution',
]);
const skippedFiles = /(^\.DS_Store$|\.lock$|-shm$)/;

function resolveSource(raw) {
  const source = resolve(repoRoot, raw);
  if (existsSync(join(source, 'workspace', 'workspace.sqlite'))) return { dataRoot: source };
  if (existsSync(join(source, 'workspace.sqlite'))) return { workspaceOnly: source };
  throw new ProbeError('NOT_FOUND', `${raw} 不是 Linnya 数据目录`, '传入含 workspace/workspace.sqlite 的目录，例如 _dev_data');
}

/**
 * 用 APFS clonefile 复制一份数据给探针实例：同卷时瞬时完成、几乎不占空间，之后两边各写各的。
 * 只读取源目录，从不打开源数据库，因此不会触发源库的 WAL checkpoint 或锁。
 */
export async function cloneWorkspaceData(raw, instanceWorkspace) {
  const { dataRoot, workspaceOnly } = resolveSource(raw);
  const sourceRoot = resolve(dataRoot ?? workspaceOnly);
  if (`${resolve(instanceWorkspace)}${sep}`.startsWith(`${sourceRoot}${sep}`)) {
    throw new ProbeError('USAGE', '克隆目标不能位于源目录之内');
  }
  const started = Date.now();
  rmSync(instanceWorkspace, { recursive: true, force: true });
  const from = dataRoot ?? workspaceOnly;
  const to = dataRoot ? instanceWorkspace : join(instanceWorkspace, 'workspace');
  let files = 0;
  let bytes = 0;
  // macOS 上 FICLONE 走 clonefile；同卷时瞬时完成且共享数据块，跨卷时退回普通复制。
  cpSync(from, to, {
    recursive: true, mode: constants.COPYFILE_FICLONE, preserveTimestamps: true,
    filter: path => {
      const inside = relative(from, path);
      if (!inside) return true;
      const top = inside.split('/')[0];
      if (dataRoot && skippedRoots.has(top)) return false;
      if (skippedFiles.test(basename(path))) return false;
      const stat = statSync(path);
      if (stat.isFile()) { files += 1; bytes += stat.size; }
      return true;
    },
  });
  const skipped = dataRoot ? readdirSync(from).filter(name => skippedRoots.has(name)) : [];
  // 源库正被 Desktop 写入时，主库与 WAL 不是同一瞬间复制的；在副本上检查一次，坏了就明确报错。
  const wal = statSync(join(from, dataRoot ? 'workspace' : '', 'workspace.sqlite-wal'), { throwIfNoEntry: false });
  if (wal?.size) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(to, dataRoot ? 'workspace' : '', 'workspace.sqlite'));
    try {
      const result = db.prepare('PRAGMA quick_check').get();
      if (Object.values(result)[0] !== 'ok') {
        throw new ProbeError('CLONE_INCONSISTENT', '源库正在写入，克隆副本不一致', '先退出使用该数据的 Desktop 再克隆');
      }
    } finally {
      db.close();
    }
  }
  return { source: from, files, logicalBytes: bytes, skipped, sourceLive: Boolean(wal?.size), ms: Date.now() - started };
}
