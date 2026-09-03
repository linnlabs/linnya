# AudioBlock 文件结构

```
AudioBlock/
├── index.js                          # 模块导出入口
├── AudioBlock.js                     # AudioBlock 主逻辑
│
├── ui/                               # UI 组件
│   ├── AudioBlockView.vue            # 音频块主视图容器
│   ├── AudioPlayer.vue               # 音频播放器主组件
│   ├── AudioWaveform.vue             # 波形可视化组件
│   ├── RecordingControls.vue        # 录音控制按钮组件
│   ├── StatusMessage.vue            # 状态消息显示组件
│   ├── WaveformRenderer.js          # 波形渲染逻辑
│   │
│   ├── components/                  # AudioPlayer 子组件
│   │   ├── ProgressBar.vue          # 进度条组件
│   │   ├── TranscriptionButton.vue  # 转录按钮组件
│   │   ├── CreateMenu.vue           # 创建内容菜单（纪要/邮件）
│   │   └── PanelToggleButton.vue    # 面板展开/隐藏按钮
│   │
│   ├── composables/                 # AudioPlayer 可组合逻辑
│   │   ├── useAudioPlayback.js      # 播放控制逻辑
│   │   ├── useProgressControl.js    # 进度条拖拽和跳转逻辑
│   │   └── useCreateActions.js      # 生成纪要等内容的逻辑
│   │
│   └── content-panel/               # 内容面板 Tab 组件
│       ├── AudioContentPanel.vue    # 内容面板容器
│       ├── TranscriptTab.vue        # 转录文本 Tab
│       ├── TranscriptSegmentView.vue           # 转录文本视图
│       ├── SummaryTab.vue           # 纪要 Tab
│       ├── NotesTab.vue             # 笔记 Tab
│       ├── SubEditorFindReplaceExtension.js    # 子编辑器查找替换扩展
│       ├── transcriptSegmentExtension.js       # 为转录文本提供自定义节点
│       ├── transcriptDataConverter.js          # 转录数据工具
│       └── TimestampExtension.js    # TipTap 时间戳扩展
│
├── services/                        # 业务服务
│   ├── AudioRecordingService.js     # 录音服务
│   ├── transcriptionService.js      # 转录服务（调用后端 API）
│   └── audioContentAiService.js     # AI 生成内容服务（纪要等）
│
├── store/                           # 状态管理（已拆分为多个独立 Store）
│   ├── index.ts                     # Store 聚合导出 + 兼容层
│   ├── audioContent.store.js        # 内容管理：笔记/转录/摘要的草稿、加载与持久化
│   ├── audioRuntime.store.js        # 运行时管理：录音/播放状态、设备、音频文件加载
│   ├── audioEditors.store.js        # 编辑器注册表：子编辑器实例管理（查找替换等）
│   └── audioDevice.js               # 设备管理：麦克风检测与权限
│
├── repository/                      # 数据仓储层
│   └── audioRepository.ts           # 封装 IPC 调用、序列化与错误处理
│
├── types/                           # 类型定义
│   └── audioBlock.ts                # AudioBlock 类型、接口与类型守卫
│
├── menu/                            # 右键菜单
│   └── audioBlockMenuProvider.ts    # AudioBlock 右键菜单提供者
│
├── utils/                           # 工具函数
│   └── segmentBatcher.js            # Segment 分批工具（翻译等场景）
│
└── composables/                     # 全局可组合逻辑
    └── useAudioAnalyser.js          # 音频分析器（音量可视化等）
```

