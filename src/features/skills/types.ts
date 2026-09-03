/**
 * @file src/features/skills/types.ts
 * @description Linnya Skill 核心类型定义
 *
 * 中文备注：
 * - 对齐 Agent Skills 开放规范（agentskills.io/specification）；
 * - Skill 有三种来源：builtin（代码仓库内置）、plugin（插件资源）和 user（用户文件系统）；
 * - 三者都是标准的 SKILL.md 文件，格式完全一致；
 * - 内置 Skill 优先级最高，不可覆盖、不可删除；
 * - 插件 Skill 随插件安装、启用、升级收缩；
 * - 用户 Skill 仅作为补充，同名时被忽略。
 */

// ─── SKILL.md 文件格式 ───

/**
 * SKILL.md frontmatter 标准字段（对齐 agentskills.io/specification）
 */
export interface SkillFrontmatter {
  /**
   * Skill 唯一标识（必需）
   * 规范约束：1-64 字符，小写字母+数字+连字符，不以连字符开头/结尾，无连续连字符，
   * 必须与父目录名匹配。
   */
  name: string;

  /**
   * Skill 描述（必需，1-1024 字符）
   * 需要同时表达"做什么"和"什么时候该用"，包含具体关键词便于 Agent 匹配。
   */
  description: string;

  /** 许可证名称或引用（可选） */
  license?: string;

  /** 环境兼容性说明，1-500 字符（可选） */
  compatibility?: string;

  /** 自定义元数据，string→string 键值对（可选） */
  metadata?: Record<string, string>;

  /**
   * 预批准的工具列表，空格分隔（可选，实验性）
   * 规范标注为 experimental，Linnya 首版仅存储不执行。
   */
  'allowed-tools'?: string;

  /**
   * 是否禁止模型自动触发（仅允许用户显式调用）
   * 注意：此字段不在 Agent Skills 标准规范中，是 Claude Code 扩展字段，
   * Linnya 选择支持以兼容更广泛的 Skill 生态。
   */
  'disable-model-invocation'?: boolean;
}

/**
 * SKILL.md 解析结果（包含 frontmatter + body）
 */
export interface ParsedSkillFile {
  frontmatter: SkillFrontmatter;
  /** SKILL.md 正文（frontmatter 之后的 markdown 内容） */
  body: string;
}

// ─── Skill 来源 ───

/**
 * Skill 来源类型
 * - builtin：代码仓库内置，随代码发布，不可覆盖
 * - plugin：插件 artifact 提供，随插件启停/升级收缩
 * - user：用户文件系统创建，仅作为补充
 */
export type SkillSource = 'builtin' | 'plugin' | 'user';

// ─── 统一的 Skill 元数据（运行时） ───

/**
 * 统一的 Skill 元数据（Tier 1 产物）
 *
 * 中文备注：
 * - 内置、插件、用户 Skill 都是标准 SKILL.md 文件，解析后统一为此结构；
 * - 三者的区别仅在 source 和文件所在位置，其余完全同构。
 */
export interface SkillMetadata {
  /** Skill 名称 */
  name: string;
  /** Skill 描述 */
  description: string;
  /** 来源 */
  source: SkillSource;
  /** 是否禁止模型自动触发 */
  disableModelInvocation: boolean;
  /** 自定义元数据，例如插件归属。 */
  metadata?: Record<string, string>;
  /** SKILL.md 文件的绝对路径 */
  location: string;
  /** Skill 所在目录的绝对路径（location 的父目录） */
  directory: string;
}

/**
 * Skill 目录中的资源文件信息
 */
export interface SkillResource {
  /** 相对于 Skill 目录的路径（如 "references/REFERENCE.md"） */
  relativePath: string;
  /** 绝对路径 */
  absolutePath: string;
}
