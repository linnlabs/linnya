/** 插件只能写有界诊断记录；级别、目的地和关闭均由 Host 生命周期拥有。 */
export type PluginLoggerDetails = unknown;

export interface PluginLoggerPort {
  debug(message: string, details?: PluginLoggerDetails): void;
  info(message: string, details?: PluginLoggerDetails): void;
  warn(message: string, details?: PluginLoggerDetails): void;
  error(message: string, details?: PluginLoggerDetails): void;
}

export interface PluginLoggerConstructor {
  new (moduleName: string): PluginLoggerPort;
}

export declare class Logger implements PluginLoggerPort {
  constructor(moduleName: string);
  debug(message: string, details?: PluginLoggerDetails): void;
  info(message: string, details?: PluginLoggerDetails): void;
  warn(message: string, details?: PluginLoggerDetails): void;
  error(message: string, details?: PluginLoggerDetails): void;
}
