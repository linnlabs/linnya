# Historical corpus experiment Host

这是开发实验装配，复用正式 Backend、Graph、Conversation
CLI、Workspace、Citation/Evidence 和 Audit，不实现第二套 Agent
loop。生产入口不导入本目录，也不识别语料、预测时点或结算配置。

Benchmark 的 `forecast-preflight`
校验语料清单并输出作者投影，不证明历史真实性或执行隔离。本目录把冻结 Web
provider、独立缓存、配套 ToolRuntime/ToolManager 和禁止物理文件读取的 port 一起交给根运行及所有 child。未知 URL 明确失败，没有实时 Web 回退；生产工具参数和普通搜索行为不变。

实验提供 Workspace 文件、任务记录、通用 subagent、冻结的 deep-research
Skill 和网页资料工具。Shell、Process、Knowledge、插件工具及宿主文件读取不开放。原本拥有 Shell 的角色得到固定算术
`calculate`，不接受代码；深搜角色不因此获得计算权限。这是实验能力替换，不能声称与开放研究的工具条件完全相同。

每次启动要求全新 Workspace，模型配置按哈希复制，通过正式 Workspace
owner 分别创建研究项目和合成读写验证项目，后者的文档不能交给研究作者。AppData、插件目录、默认模型目录和 Skill 文件也要单独准备，不借用用户历史。启动失败后保留身份和目录，不做幂等重发或跨进程恢复；同一运行中的暂停恢复仍使用原装配。已有 ready 或 connection 身份会在启动前拒绝。

`scripts/benchmark/build-historical-runtime.ts`
复用正式 Backend 构建选项，生成标准 `host-root/dist/main`
布局的独立产物。实验配置路径只编入开发产物，不进入生产 bootstrap 或环境白名单。构建需要已准备好的正式 headless
Node、Qdrant、队列 worker、命令运行资源和 Node parser-wasm，并复制冻结 deep-research Skill；缺少已构建资源就失败。操作者另行准备文件凭据、模型配置及实验配置，不得提交本地凭据或私有资料。

调用模型前必须用正式 CLI 在验证项目中执行长 Markdown 写入、完整分页回读、精确编辑及再次回读。仅有 Host ready 和纯函数测试不足以证明文档资源齐备。语料也须全文核对正文边界；哈希和发布日期检查无法自动识别当前网站导航混入历史稿件。环境失败与模型研究失败分别记账，修复后另开身份，不能覆盖失败样本。

运行回执记录语料及配置身份，不代表 Host 已就绪、文章正确、操作系统网络沙箱或模型知识无污染。真实 ready 来自正式 CLI 握手，模型 API 仍需联网。capturedAt 保持实际取得时刻，公开日期单列；当前官方历史期次的副本不自动成为发布当日的字节快照。

合成业务测试覆盖准入、冻结搜索/读取、引用、工具拒绝、算术及实际 child 模型工具目录。无模型启动验收与真实研究样本分别记录。真实运行前冻结代码/产物、题面、语料、模型和预算；运行后通过正式投影及审计核对，不从数据库重建文稿，不把“已核验”自述当检查结果。
