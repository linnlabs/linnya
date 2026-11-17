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
    description: '计划进入 renderer-ui 的组件原型：侧栏 Agent 运行状态、徽标、空状态、折叠区与加载。原型在画廊 prototypes/，还不是包内组件。',
  },
  {
    id: 'new-project',
    label: '方向：新项目空态',
    description: '新项目侧栏空态的几种方向（W-0360）：现状、列表行、一个入口、图块，可切换类型数量。只在画廊。',
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
