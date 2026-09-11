# Settings Renderer Domain

Settings 是设置壳与 contribution registry，不是所有设置业务的统一 owner。

## 负责

- 设置弹窗、分组、导航、通用 Settings Kit 和本地化集成；
- 注册各 domain 提供的设置页面；
- 设置壳自身的外观、会话通用偏好等稳定设置能力。

## 不负责

- 模型注册、模型目录、Provider connection 或用途绑定；这些属于 `model-configuration`；
- Knowledge Base、Editor、Conversation 等 domain 的内部业务规则；
- 为方便组装而直接读取或修改其他 domain store。

其他 domain 需要嵌入设置页时，只能从 `public.ts` 使用 Settings Kit 与本地化合同；Settings registry 则从该 domain 的 `index.ts` 注册公开 UI。禁止双方深层导入内部文件。模型配置的目录、开发规范和依赖图见 [`../model-configuration/README.md`](../model-configuration/README.md)。

开发态“内存诊断”由 `app/system/features/process-memory-observation` 拥有，只通过公开 contribution 合同注册到设置壳。录制会话在设置弹窗关闭后继续运行，Settings 不读取或修改其 store。

设置页通过 Vue async component 按 Tab 首次挂载加载，registry 注册本身不得提前导入全部页面。跨域页面仍由对应
domain 的公开入口提供异步组件，不能为了懒加载在 Settings 中深层导入对方 UI。全局 lifecycle 与状态查询保持正常启动，页面加载不承载其初始化副作用。
