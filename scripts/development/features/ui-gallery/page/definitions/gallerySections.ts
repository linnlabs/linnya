export interface GallerySectionDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export const GALLERY_SECTIONS = [
  {
    id: 'foundations',
    label: '颜色与字体',
    description: '表面、文字、边框、强调色、状态色、基础色阶、字阶、间距、圆角与投影。文字色旁是相对页面底色的实测对比度。',
  },
  {
    id: 'buttons',
    label: '按钮',
    description: 'BaseButton 的八种层级与三档尺寸、IconButton 与 ActionButtons。',
  },
  {
    id: 'inputs',
    label: '输入',
    description: '单行、多行、密文、数字、滑块与原位编辑。',
  },
  {
    id: 'selection',
    label: '选择',
    description: '复选、单选、开关、分段页签与标签。',
  },
  {
    id: 'menus',
    label: '菜单与浮层',
    description: '选择器、动作菜单、文字浮层、日期时间与颜色面板。',
  },
  {
    id: 'feedback',
    label: '反馈与加载',
    description: '通知条、骨架屏、Linnya 加载图标、分区标题与回到底部。',
  },
  {
    id: 'dialogs',
    label: '对话框',
    description: 'Modal、确认框与图片预览。',
  },
  {
    id: 'toolbars',
    label: '工具条',
    description: '浮动工具条、分组、格式按钮与颜色按钮。',
  },
  {
    id: 'icons',
    label: '图标',
    description: '/icons 导出的全部平台图标与品牌标识。',
  },
  {
    id: 'form-example',
    label: '组合：设置表单',
    description: '只用 Renderer UI 组件拼成的设置表单，用来看控件放在一起时的整体气质；不是真实设置页。',
  },
  {
    id: 'candidates',
    label: '候选组件（计划中）',
    description: '计划进入 renderer-ui 的组件原型：徽标、空状态、折叠区与加载（侧栏运行状态见“方向对比：侧栏运行状态”）。原型在画廊 prototypes/，还不是包内组件。',
  },
  {
    id: 'document-top',
    label: '方向对比：文档顶部',
    description: 'Markdown 工具栏改悬浮、文档栏改标签页的对比预览。用真实工具条组件拼的示意，不是真实页面。',
  },
  {
    id: 'conversation-tier',
    label: '方向对比：对话档位',
    description: '每个对话单独的命令权限档位：输入框里的显示位置、切换菜单、完全访问确认框、调低全局设置时的提示。用真实组件拼的示意，不是真实页面。',
  },
  {
    id: 'conversation-tier-icons',
    label: '方向对比：档位图标与位置',
    description: '档位放到模型选择左边；完全访问只改字色，或换成档位图标、悬停显示档位；新对话不显示用量环。已选定 B1（盾牌一族），已落到真实输入框；这里保留对比示意。',
  },
  {
    id: 'scheduled-tasks',
    label: '方向对比：定时任务',
    description: '定时任务的入口、任务视图与运行记录、新建表单、Agent 建任务后的提示和相关确认框。用真实组件拼的示意，不是真实页面。',
  },
  {
    id: 'sidebar-run-status',
    label: '方向对比：侧栏运行状态',
    description: '侧栏对话行的 Agent 运行状态：进行中、待回答、待审批、已中断（打开后消失）、无运行。现状、推荐做法与 11-17 候选并排，另有置顶、正在看、悬停、收起项目和窄侧栏的情形。用真实组件拼的示意，不是真实页面。',
  },
  {
    id: 'conversation-steering',
    label: '方向对比：运行中插话',
    description: 'Agent 运行时发消息：输入框里的暂停与发送、待送达条（编辑、撤回、立即打断）、插话在时间线里的位置，以及等子任务、等批准、回复先写完等情形。用真实组件拼的示意，不是真实页面。',
  },
  {
    id: 'list-example',
    label: '组合：列表与卡片',
    description: '按设计规范 9.4、9.6 拼出的列表行与卡片，用来看层级与留白；不是真实侧栏。',
  },
] as const satisfies readonly GallerySectionDefinition[];

export type GallerySectionId = (typeof GALLERY_SECTIONS)[number]['id'];

export const DEFAULT_GALLERY_SECTION_ID: GallerySectionId = 'foundations';

/** 截图或对比时可经 URL 直接打开的浮层。 */
export const GALLERY_OVERLAYS = ['dialog', 'confirm', 'danger-confirm', 'image-preview'] as const;

export type GalleryOverlayId = (typeof GALLERY_OVERLAYS)[number];
