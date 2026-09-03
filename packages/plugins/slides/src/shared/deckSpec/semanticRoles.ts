/**
 * Slides 语义角色合同。
 *
 * 这些值会同时进入布局语义、编辑目标和插件 IPC DTO。放在 shared 内，是为了让
 * host、renderer 和未来独立安装的 slides 包引用同一份窄合同，而不是穿透旧 domain。
 */
export type SemanticRole =
  | 'claim'
  | 'evidence'
  | 'annotation'
  | 'action'
  | 'footnote'
  | 'primary-visual'
  | 'headline'
  | 'eyebrow'
  | 'subtitle'
  | 'kpi-value'
  | 'axis-label'
  | 'quadrant-label'
  | 'milestone'
  | 'takeaway'
  | 'divider';
