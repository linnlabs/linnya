# Skills Renderer Domain

拥有当前 Skill 文件的管理界面：安装、查看/编辑、整包升级、卸载。Settings 壳仅从公开 index 注册异步页面，页面复用 Settings Kit 与 Renderer UI。内置/插件只读，用户来源可编辑；没有历史或回退。

`features/user-skill-management` 中 definitions 拥有状态和中英文文案；store 仅同步持有状态；orchestration 调用 API、确认覆盖/删除与提交动作；infrastructure 解析共享 schema；Vue 仅呈现与连接交互。API 失败就近展示，保存使用读取时的原文防止覆盖外部编辑。

刷新同时重新发现目录和读取所选文件；外部卸载后清除旧编辑目标，支持文件已被整包升级移除时回到 SKILL.md。刷新前沿用未保存修改的丢弃确认，不把过期草稿当作当前文件。

样式从 `styles/index.css` 进入 App 唯一样式装配，消费三主题语义 token，不覆写共享组件内部样式。编辑器使用 CustomTextarea 的公开 control-class。数据流为 Renderer API → Skills owner，与 Agent/CLI 共用文件操作。
