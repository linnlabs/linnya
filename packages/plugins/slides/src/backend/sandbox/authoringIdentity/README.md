# 系统编辑身份

本模块拥有 deck.js 调用来源、源码标记和沙箱内身份分配。它不拥有布局、人工值、保存或选择状态。

- `functions/authoringSource.ts` 用插件自带 TypeScript AST 识别工厂与本地 helper 调用，只做定点插入；不重新打印作者程序。
- `functions/authoringIdentityRuntimeSource.ts` 以同步作用域记录创建路径，`finally` 退出作用域；在 compose 前为可见叶子与装饰 Frame 分配身份。它不使用布局诊断的 1024 节点登记表。
- `functions/authoringPathKey.ts` 为源码写入和沙箱提供同一个路径编码算法。不同路径编码碰撞明确失败，不挑选对象。

## 身份规则

显式且唯一的 `slideKey/editKey` 保持原有语义。系统键使用 `sysp_`（页面）、`sysu_`（唯一调用路径）、`sysr_`（重复、循环或无法完整追踪的路径）命名空间；消费者将其视为 opaque key，不拆解成业务身份。重复显式 key 的对象改获系统身份，原 key 引用停用，不能把修改套给第一个候选。

唯一来源由调用点标记路径决定，不由正文、几何或页序决定。循环、单项循环、内联回调、间接 helper 调用和递归来源采用生成程序摘要及实例序号，只在同一生成程序内保持对应。摘要忽略注释、格式、系统页面 key 与静态 `compose.manualEdits`，因此正常人工保存不改变身份；任何生成逻辑变动都可能停用这些实例的旧覆盖。显式数据 key 是需要跨此类改稿保持实例身份的正式方式；系统不从同文、位置或实例数量推断它。

源码标记为 `/*@slides-id:a…*/`。首次保存系统身份稿时固定当前所有调用点，页面身份同样由调用点注释固定，不修改用户 config 的字段；这是一笔普通人工 revision，撤销时一起恢复。一次固定调用点让未等待保存的后续队列操作仍使用同一 ref，不需要根据画面重新匹配。标记只是注释，保留 `createText(42)` 等简写的转换语义；追踪 wrapper 使用惰性求值，不改变参数求值顺序。复制生成对象时不得复制其独立身份标记。

无装饰且无显式 key 的布局容器不进入点击层级。显式分组仍保留，装饰 Frame 与子元素各有身份。编辑能力继续由 RenderModel mapper 按对象类型投影，图表、表格、SVG 和公式获得身份不代表新增其内容编辑器。

## 保存与兼容

继续使用现有严格 v1/v2 codec，写入 v2；没有新增路径字符串或 v3 数据格式。人工值失联解析归 `codegen/compose/flex-layout/resolveManualEditTargets`，非法值仍拒绝。失联记录保留在源码，只有同一身份再次被明确恢复时才生效；循环记录不会按内容自动重挂。

`DeckSpec.authoringIdentityVersion=1` 标记当前编译能力。旧产物由 query owner 基于捕获源码与主题只读补充编译，并最多缓存最近一次旧修订物化；编辑 owner 在同一 CAS 基线重新获得同源作者事实后才保存。读取不会创建用户修订或改写源码。首次实际编辑才持久化标记、人工值和新 DeckSpec，沿用 draft guard、回执与延迟 PPTX。

失联与源码移除人工记录的诊断同时进入写入反馈及 DeckSpec 派生警告；预览将其传给 Renderer，原始人工值仍由源码或源码历史拥有。新命令的目标必须在当前快照存在，不能借失联记录的容错提交不存在的目标。

## 验证

`authoringIdentity.integration.test.ts` 穿过正式 profile/evaluator 与 Yoga，验证简写、helper、重复数字、单项循环、间接回调、1100 个对象、标记等价与停用。保存、队列、重开和 PPTX 验证位于 backend 的 manual-edit 集成测试。发布仍须执行插件类型、lint、全量业务测试、backend artifact smoke 与原生预览交互验收。

系统结构编辑通过 `/*@slides-generation:世代:程序摘要*/` 保留原有循环实例对应关系；只有当前程序摘要匹配才使用该世代。AI 改码但保留旧标记时摘要不匹配，恢复到新程序摘要并停用旧覆盖。这份标记由人工编辑 owner 在同一修订中更新，不是忽略源码变化的全局开关。
