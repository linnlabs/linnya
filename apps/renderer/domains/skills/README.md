# Skills Renderer Domain

拥有 Skill 的设置页：查看全部 Skill，安装、升级、卸载、编辑用户 Skill；没有历史、回退或审核队列。Settings 壳仅从公开 index 注册异步页面，页面复用 Settings Kit 与 Renderer UI。

## 页面与交互

- 列表按“我的 Skill / 内置 / 插件”分组，每行显示名称和描述；不可用的 Skill 带警示标记，原因写在描述位置。没有自己的 Skill 时给出引导，说明可以让 Agent 在对话里沉淀或从文件夹安装。
- 点击一行打开详情弹窗：左侧文件树（`SKILL.md` 在最前，目录只是分组标题），右侧编辑区。内置与插件 Skill 在同一弹窗只读查看，没有底部操作。
- 安装与升级都先经系统文件夹选择器取得本机目录，再调用 `validate` 读出名称、描述和文件数，用全局确认框展示后才写入。名称取自文件夹里的 `SKILL.md`，不需要手填；已存在同名用户 Skill 时按“替换”确认并升级。升级时文件夹里的名称必须与当前 Skill 一致。
- 卸载、替换、升级和放弃未保存修改都经全局确认框；危险操作的确认按钮使用危险样式。
- 窗口重新获得焦点时静默刷新列表：外部修改会读入，外部卸载会关闭详情，未保存的编辑不会被覆盖。
- 不提供在界面里新建或删除支持文件：用得少，Agent 或外部编辑器都能做，需要时整包升级即可。

## 结构

`features/user-skill-management`：`definitions` 拥有状态和中英文文案；`functions` 是分组与文件树的纯规则；`store` 仅同步持有状态；`orchestration` 调用 API、确认并提交动作；`infrastructure` 解析共享 schema、封装文件夹选择器；Vue 只呈现与连接交互。API 失败就近展示：详情打开时显示在弹窗底部，否则显示在列表上方。保存使用读取时的原文防止覆盖外部编辑。

样式从 `styles/index.css` 进入 App 唯一样式装配，只消费语义 token，不覆写共享组件内部样式；编辑区使用 `CustomTextarea` 的公开 `control-class`，并只通过自己的 class 中和无边框控件悬停、聚焦时的填充底色。数据流为 Renderer API → Skills owner，与 Agent/CLI 共用文件操作。

对话里的 `skill_manage` 一行结论由 conversation 域的 Skill 工具卡呈现，不在本域。
