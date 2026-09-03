const APP_SERVER_ENVIRONMENT_KEYS = Object.freeze([
  // Node 与操作系统运行所需的最小事实。
  'NODE_ENV',
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'TZ',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'LOCALAPPDATA',
  'APPDATA',
  'PROGRAMDATA',
  'COMSPEC',
  'PATHEXT',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',

  // Linnya Backend 的显式运行配置；不允许把整个 Electron Main 环境袋透传给 sidecar。
  'LINNYA_DEV_MODE',
  'LINNYA_WORKSPACE_DIR',
  'LINNYA_CONVERSATION_ROOT',
  'LINNYA_PLUGIN_ROOT',
  'LINNYA_PLUGIN_DIRECT_DIRS',
  'LINNYA_PLUGIN_BACKEND_DIRECT_DIRS',
  'LINNYA_PLUGIN_BACKEND_LOADING',
  'LINNYA_PLUGIN_RENDERER_BUNDLE',
  'LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT',
  'LINNYA_BUNDLED_PLUGIN_ROOT',
  'MODEL_REGISTRY_DEFAULTS_PATH',
  'LINNYA_LLM_RUN_AUDIT',
  'LINNYA_LLM_RUN_AUDIT_REMINDER_MAX_ENTRIES_PER_RUNKEY',
  'LINNYA_LLM_RUN_AUDIT_PROTOCOL_ERROR_MAX_ENTRIES_PER_RUNKEY',
  'LINNYA_KG_DUMP_JSON',
  'PDF_IMG_DEBUG',
  'AUDIO_SAMPLE_RATE',
  'VAD_MIN_SPEECH_DURATION_MS',
  'SEGMENT_THRESHOLD_S',
  'MAX_SEGMENT_THRESHOLD_S',
  'PROJECT_ROOT',
  'WORKER_PROJECT_ROOT',
  'QDRANT_URL',

  // Web provider 的开发/部署级 fallback credential；用户在 UI 保存的密钥仍走 safeStorage RPC。
  'BAIDU_SEARCH_API_KEY',
  'SERPER_API_KEY',
  'JINA_API_KEY',
  'TAVILY_API_KEY',
  'METASO_READER_API_KEY',
] as const);

/**
 * App Server 不继承 Electron Main 的环境。尤其不能传 `ELECTRON_RUN_AS_NODE`、`NODE_OPTIONS`
 * 或动态注入变量；命令执行所需的完整登录环境通过独立 bootstrap contract 传递。
 */
export function createAppServerProcessEnvironment(
  source: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {};
  for (const key of APP_SERVER_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (typeof value === 'string') environment[key] = value;
  }
  return Object.freeze(environment);
}
