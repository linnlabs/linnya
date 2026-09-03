const LOG_PREFIX = '[Tiptap Editor]';

const styles = {
  info: 'color: #28a745; font-weight: bold;', // 绿色
  warn: 'color: #ffc107; font-weight: bold;', // 黄色
  error: 'color: #dc3545; font-weight: bold;', // 红色
  debug: 'color: #17a2b8; font-weight: bold;', // 蓝色
};

/**
 * 简单的日志记录器，只在开发环境中输出
 */
export const logger = {
  info: (...args) => {
    if (import.meta.env.DEV) {
      console.log(`%c${LOG_PREFIX}[INFO]`, styles.info, ...args);
    }
  },
  warn: (...args) => {
    if (import.meta.env.DEV) {
      console.warn(`%c${LOG_PREFIX}[WARN]`, styles.warn, ...args);
    }
  },
  error: (...args) => {
    if (import.meta.env.DEV) {
      console.error(`%c${LOG_PREFIX}[ERROR]`, styles.error, ...args);
    }
  },
  debug: (...args) => {
    if (import.meta.env.DEV) {
      console.log(`%c${LOG_PREFIX}[DEBUG]`, styles.debug, ...args);
    }
  },
}; 