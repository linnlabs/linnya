# 真实模型验收 runner

本目录只运行官方 Linnya CLI 和已定型的可信 Renderer HTTP 桥，不访问业务 SQL，不注入 JavaScript、不批准大改、不生成评分或人工审阅结论。正式13题和输入只从 scripts/agent-evaluation 公开入口读取。

调用入口为 `pnpm exec tsx --tsconfig packages/plugins/canvas/dev/agent-evaluation/runner/tsconfig.json packages/plugins/canvas/dev/agent-evaluation/runner/run.ts`，后接下列阶段参数。证据目录必须位于源码 checkout 之外。每个新阶段目录已经存在即拒绝覆盖；失败或发送响应未知时不自动重发，也不删除原证据。

- `configs MATRIX.json NEW-DIR` 只准备模型×13题配置。matrix 的 base 包含 repositoryRoot、完整40位 sourceRevision、batchId、repetition；models 每项仅包含 modelConfigId、model 的 provider/model/version 和 imageCapability；t8EvidenceMode 显式指定 network 或 offline。不能给密钥字段。该命令不调用模型、不创建业务数据。
- `setup CONFIG.json NEW-RUN-DIR` 核对冻结实现，保存 doctor/models 原始事实，用官方 projects/create 为本题建独立项目，通过 write_file 建固定资料和空 Canvas。保存实际稳定ID与原始请求/响应。由 UI 为这个项目正常启动桥后，继续 attach。
- `attach RUN-DIR CONNECTION.json` 验证桥绑定同项目，正式 mount；按最多500条通过 Renderer 用户提交播种，确认每条 applied；fit 后读取 before-setup。T11进入 X 的正式编辑会话，此后由真实键盘留下草稿，runner不伪造输入。
- `start RUN-DIR` 保存发送前真实快照、草稿和统计起点，用配置的模型与 high reasoning 发送固定提示。看图组明确要求 check→render→实际 read_file；不看图组只 check。保存真实 conversation/run receipt；不会自动补发或修改提示。
- `wait RUN-DIR NEW-LABEL [TIMEOUT-MS]` 每5秒记录官方 status，终态、暂停、等待用户或超时即返回；默认20分钟。超时不会停止或重启模型。T9允许、T12拒绝仍由真实产品按钮操作并保留截图。
- `collect RUN-DIR NEW-LABEL` 保存 status/audit/result、全部 messages 前向分页、Renderer after/draft/stats。保留 preparing、非零退出码、源代码变化和资源错误；sourceValid/messagesComplete/evidenceComplete 只说明采集状态，不能当任务通过。连续采集使用新 label，不覆盖旧结果。

配置中的 repositoryRoot 必须是活动 App 所属的工作目录，CLI 使用该目录的正式连接规则，继承调用环境，不跨实例找连接或读取凭据。每次 setup/attach/start 核对完整 HEAD 与工作区；仅允许桥自己加入 index.html 的临时 script，任何生产修改都要求新批。collect 在代码变化时仍保留原始首败证据，但明确标无效。

证据记录 argv、原始 stdout/stderr、退出码和时刻；桥 nonce 只从0600连接文件读入请求头，不复制到日志。消息分页保留完整原始工具事实，不能从模型文本猜提交、check、图片已读或批准。后续由可信审阅流程提取实际工具trace中的 check/commit/render/read_file，补真实UI截图和语义审阅，再交正式评分入口；本 runner 不写 run.json 或 report.json。

每题完成后正常关闭上一桥，确认其标签和 descriptor已释放，再为下一独立项目启动桥。保留已配置模型与 App profile，不批量关闭其他任务的进程。固定提交上完整跑完各模型的13题，任何产品修复另开整批，不把旧成功题拼成新实现的结果。
