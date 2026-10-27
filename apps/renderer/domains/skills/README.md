# Skills Renderer Domain

拥有 Skill 的设置页：查看全部 Skill，安装、升级、卸载、编辑用户 Skill；没有历史、回退或审核队列。Settings 壳仅从公开 index 注册异步页面，页面复用 Settings Kit 与 Renderer UI。

## 页面与交互

- 页面采用左侧选择、右侧预览：列表与预览按约 1:2 分配宽度，列表至少预留 200px，窄容器内改为上下布局。列表按“我的 Skill / 内置 / 插件”分组，每行显示名称和描述；不可用的 Skill 带警示标记，原因写在描述位置。首次进入默认预览第一个 Skill。没有自己的 Skill 时给出对话创建或文件夹安装的引导。
- 左侧列表由 `SkillListSidebar` 拥有呈现和滚动生命周期，使用 Renderer UI Scroll 的 Linnya 主题与悬停显示策略；不再显示系统原生滚动条，也不单独实现滚动条样式。
- 卡片视觉参考 Linnsy 的记忆设置：浮起表面、发丝描边、宽而轻的阴影，内容在 260–420px 内自然增高，超出后通过 Renderer UI Scroll 滚动。编辑提示在悬停或键盘聚焦时出现，触屏保留可见入口；内边距归内容层所有，不放在滚动组件接管的 viewport 上。
- 点击预览卡片进入详情弹窗：左侧文件树（`SKILL.md` 在最前，目录只是分组标题），右侧原文编辑与 Markdown 预览切换。内置与插件 Skill 只读，默认展示预览，没有保存、升级和卸载操作。
- 原文编辑通过 Editor domain 的窄公开入口 `text-file.ts` 复用已有 CodeBlock，提供按文件后缀确定的高亮、语言标签、复制和缩进；保留 YAML 头、缩进与文件原文，不接入工作区文档会话。预览使用现有 Markdown-it 与 DOMPurify；`SKILL.md` 的 YAML 头只在预览中隐藏，不回写文件。切换预览不销毁编辑实例，保留草稿、选区和撤销记录。
- 安装与升级都先经系统文件夹选择器取得本机目录，再调用 `validate` 读出名称、描述和文件数，用全局确认框展示后才写入。名称取自文件夹里的 `SKILL.md`，不需要手填；已存在同名用户 Skill 时按“替换”确认并升级。升级时文件夹里的名称必须与当前 Skill 一致。
- 卸载、替换、升级和放弃未保存修改都经全局确认框；危险操作的确认按钮使用危险样式。关闭弹窗回到原文预览，未保存的草稿不进入预览事实。
- 窗口重新获得焦点时静默刷新列表：外部修改会读入，外部卸载会关闭详情，未保存的编辑不会被覆盖。
- 不提供在界面里新建或删除支持文件：用得少，Agent 或外部编辑器都能做，需要时整包升级即可。

## 结构

`features/user-skill-management`：`definitions` 拥有状态和中英文文案；`functions` 是分组与文件树的纯规则；`store` 仅同步持有状态；`orchestration` 调用 API、确认并提交动作；`infrastructure` 解析共享 schema、封装文件夹选择器；Vue 只呈现与连接交互。API 失败就近展示：详情打开时显示在弹窗底部，否则显示在列表上方。保存使用读取时的原文防止覆盖外部编辑。

样式从 `styles/index.css` 进入 App 唯一样式装配，只消费语义 token，不覆写共享组件或其他 domain 内部样式；Tiptap 原文控件的样式由 Editor domain 装配，Skills 只拥有外围布局。数据流为 Renderer API → Skills owner，与 Agent/CLI 共用文件操作。`detail` 持有当前选中的文件事实与草稿，`editorOpen` 只表达编辑弹窗是否打开，不复制预览内容。

对话里的 `skill_manage` 一行结论由 conversation 域的 Skill 工具卡呈现，不在本域。
