/**
 * @file src/features/skills/builtin/index.ts
 * @description 内置 Skill 目录定位（开发/生产环境兼容）
 *
 * 中文备注：
 * - 内置 Skill 是标准 SKILL.md 文件，与用户 Skill 完全同构；
 * - 开发模式：SKILL.md 在源码目录 builtin/skills/ 下，直接读取；
 * - 生产模式：构建时由 copy-files.js 复制到 dist/builtin-skills/，打包进 asar；
 * - 路径解析通过 __dirname + 环境判断，无需复杂多候选逻辑。
 */

import fs from 'fs';
import path from 'path';
import { getProjectRoot } from '../../../shared/utils/pathManager';

/**
 * 获取内置 Skill 根目录的绝对路径
 *
 * 中文备注：
 * - 开发模式（LINNYA_DEV_MODE=true）：指向 src/features/skills/builtin/skills/
 * - 生产模式：指向 dist/builtin-skills/（由 copy-files.js 构建时复制）
 * - 新增内置 Skill 时只需在源码目录下创建 <name>/SKILL.md
 */
export function getBuiltinSkillsRoot(): string {
  /**
   * 中文备注：
   * - 运行时经常是“源码 + 编译产物混合”：
   *   - 开发：Electron 主进程可能直接跑 dist/main/main.cjs，但源码目录仍在工作区；
   *   - 生产：md 资源会被复制到 dist/builtin-skills 并随 asar 分发。
   * - 因此这里必须基于“真实目录存在性”选择路径，不能依赖单一 env 或单一 __dirname 形态，
   *   否则会导致 discoverSkills() 结果为空，从而 system prompt 无 <available_skills>。
   *
   * ⚠️ 关键兼容性说明：
   * - 本模块会同时在 CJS（打包产物）与 ESM（tsx 直跑源码/脚本）环境中被加载；
   * - ESM 下没有 `__dirname`，会直接抛 ReferenceError；
   * - 因此候选路径全部基于 projectRoot / resourcesPath 推导，避免使用 `__dirname`。
   */
  const projectRoot = getProjectRoot();

  const candidates: string[] = [
    // 1) 源码形态：从项目根定位到 src/...（当运行时在 dist/ 里，但工作区仍有 src/）
    path.join(projectRoot, 'src', 'features', 'skills', 'builtin', 'skills'),
    // 2) 生产/构建形态：项目根下 dist/builtin-skills（若构建链路已复制）
    path.join(projectRoot, 'dist', 'builtin-skills'),
    // 3) 打包准备目录：dist_build/dist/builtin-skills（copy-files.js 写入的位置）
    path.join(projectRoot, 'dist_build', 'dist', 'builtin-skills'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // 兜底：尝试从 process.resourcesPath 定位（Electron 打包后）
  try {
    if (process.resourcesPath) {
      const candidates = [
        path.join(process.resourcesPath, 'app', 'dist', 'builtin-skills'),
        path.join(process.resourcesPath, 'app.asar', 'dist', 'builtin-skills'),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    // 非 Electron 环境
  }

  console.warn(
    '[Skill] 内置 Skill 目录未找到，内置 Skill 将不可用。已尝试路径: ' +
    candidates.join(', ')
  );
  // 最终兜底：返回“最可能”的生产路径，保持返回值稳定
  return path.join(projectRoot, 'dist', 'builtin-skills');
}
