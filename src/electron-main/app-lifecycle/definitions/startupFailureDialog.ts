/** 生成启动失败说明所需的宿主事实；只在 Main 已知的范围内填写。 */
export interface StartupFailureDialogContext {
  readonly locale: string;
  readonly applicationVersion: string;
  readonly distributionKind: string;
  readonly platform: string;
  readonly osRelease: string;
  readonly arch: string;
  /** 数据目录；诊断里把用户主目录写成 `~`。 */
  readonly dataDirectory: string | null;
  readonly homeDirectory: string;
}

export interface StartupFailureDialogView {
  readonly title: string;
  readonly headline: string;
  readonly detail: string;
  readonly copiedNotice: string;
  /** 依次是：重新启动、复制诊断信息、退出。 */
  readonly buttons: readonly [restart: string, copyDiagnostics: string, quit: string];
  readonly diagnostics: string;
}

export interface StartupFailureMessageBoxOptions {
  readonly type: 'error';
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly buttons: string[];
  readonly defaultId: number;
  readonly cancelId: number;
  readonly noLink: true;
}

/** Electron dialog 与剪贴板的窄端口；测试用假实现替换。 */
export interface StartupFailureDialogPort {
  showMessageBox(options: StartupFailureMessageBoxOptions): Promise<{ readonly response: number }>;
  writeClipboardText(text: string): void;
}

export type StartupFailureDialogChoice = 'restart' | 'quit';
