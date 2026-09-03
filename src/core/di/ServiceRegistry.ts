/**
 * @file src/core/di/ServiceRegistry.ts
 * 
 * @brief 全局服务注册表 - 依赖注入容器
 * 
 * @description
 * 功能 (What): 提供全局单例的服务注册表，支持延迟加载和类型安全的依赖注入
 * 输入 (Input): 服务名称和服务实例/工厂函数
 * 输出 (Output): 类型安全的服务实例获取
 * 副作用 (Side-effects): 管理全局服务生命周期，确保单例模式和线程安全
 */

import { Logger } from 'src/shared/logger';

const logger = new Logger('ServiceRegistry');

/**
 * 服务工厂函数类型定义
 */
export type ServiceFactory<T = any> = () => T | Promise<T>;

/**
 * 注册的服务条目
 */
interface ServiceEntry<T = any> {
  factory: ServiceFactory<T>;
  instance?: T;
  singleton: boolean;
  initialized: boolean;
}

/**
 * 支持的核心服务类型枚举
 */
export enum ServiceType {
  METADATA_REPOSITORY = 'metadataRepository',
  QDRANT_REPOSITORY = 'qdrantRepository',
  SOT_REPOSITORY = 'sotRepository',
  SEARCH_SERVICE = 'searchService',
  TASK_QUEUE = 'taskQueue',
  INGESTION_STATE_MACHINE_MANAGER = 'ingestionStateMachineManager'
}

/**
 * 服务注册表配置选项
 */
export interface ServiceRegistryOptions {
  enableLogging?: boolean;
  strictMode?: boolean; // 严格模式下，获取未注册服务会抛出异常
}

/**
 * 功能 (What): 全局服务注册表，实现依赖注入和服务生命周期管理
 * 输入 (Input): 服务注册和获取请求
 * 输出 (Output): 类型安全的服务实例
 * 副作用 (Side-effects): 管理服务实例化、缓存和销毁
 */
export class ServiceRegistry {
  private static instance: ServiceRegistry;
  private services = new Map<string, ServiceEntry>();
  private initializationPromises = new Map<string, Promise<any>>();
  private options: ServiceRegistryOptions;

  private constructor(options: ServiceRegistryOptions = {}) {
    this.options = {
      enableLogging: true,
      strictMode: true,
      ...options
    };
    
    if (this.options.enableLogging) {
      logger.info('[ServiceRegistry] 🏗️ 服务注册表已初始化');
    }
  }

  /**
   * 功能 (What): 获取ServiceRegistry的全局单例实例
   * 输入 (Input): 可选的配置选项
   * 输出 (Output): ServiceRegistry单例实例
   * 副作用 (Side-effects): 首次调用时创建全局实例
   */
  public static getInstance(options?: ServiceRegistryOptions): ServiceRegistry {
    if (!ServiceRegistry.instance) {
      ServiceRegistry.instance = new ServiceRegistry(options);
    }
    return ServiceRegistry.instance;
  }

  /**
   * 功能 (What): 注册服务工厂函数
   * 输入 (Input): 服务名称、工厂函数、是否单例
   * 输出 (Output): 当前ServiceRegistry实例（支持链式调用）
   * 副作用 (Side-effects): 将服务工厂注册到内部映射表
   */
  public register<T>(
    name: string, 
    factory: ServiceFactory<T>, 
    singleton: boolean = true
  ): ServiceRegistry {
    if (this.services.has(name)) {
      if (this.options.strictMode) {
        throw new Error(`[ServiceRegistry] 服务 '${name}' 已经注册，不能重复注册`);
      } else {
        if (this.options.enableLogging) {
          logger.warn(`[ServiceRegistry] ⚠️ 覆盖已存在的服务: ${name}`);
        }
      }
    }

    this.services.set(name, {
      factory,
      singleton,
      initialized: false
    });

    if (this.options.enableLogging) {
      logger.debug(`[ServiceRegistry] 📝 注册服务: ${name} (${singleton ? '单例' : '多例'})`);
    }

    return this;
  }

  /**
   * 功能 (What): 获取服务实例，支持延迟加载和类型安全
   * 输入 (Input): 服务名称和泛型类型
   * 输出 (Output): 类型安全的服务实例
   * 副作用 (Side-effects): 首次获取时实例化服务，单例服务会被缓存
   */
  public async get<T>(name: string): Promise<T> {
    const entry = this.services.get(name);
    
    if (!entry) {
      const errorMessage = `[ServiceRegistry] 未找到服务: ${name}`;
      if (this.options.strictMode) {
        throw new Error(errorMessage);
      } else {
        if (this.options.enableLogging) {
          logger.warn(`${errorMessage}，返回undefined`);
        }
        return undefined as any;
      }
    }

    // 如果是单例且已初始化，直接返回缓存的实例
    if (entry.singleton && entry.initialized && entry.instance) {
      return entry.instance as T;
    }

    // 处理并发初始化，避免重复创建实例
    if (entry.singleton && this.initializationPromises.has(name)) {
      return await this.initializationPromises.get(name) as T;
    }

    const initPromise = this.createInstance<T>(name, entry);
    
    if (entry.singleton) {
      this.initializationPromises.set(name, initPromise);
    }

    try {
      const instance = await initPromise;
      
      if (entry.singleton) {
        entry.instance = instance;
        entry.initialized = true;
        this.initializationPromises.delete(name);
      }

      if (this.options.enableLogging) {
        logger.debug(`[ServiceRegistry] ✅ 服务实例化成功: ${name}`);
      }

      return instance;
    } catch (error) {
      if (entry.singleton) {
        this.initializationPromises.delete(name);
      }
      
      logger.error(`[ServiceRegistry] ❌ 服务实例化失败: ${name}`, error);
      throw error;
    }
  }

  /**
   * 功能 (What): 同步获取服务实例（仅适用于已初始化的单例服务）
   * 输入 (Input): 服务名称和泛型类型
   * 输出 (Output): 类型安全的服务实例或undefined
   * 副作用 (Side-effects): 无，不会触发实例化
   */
  public getSync<T>(name: string): T | undefined {
    const entry = this.services.get(name);
    
    if (!entry || !entry.singleton || !entry.initialized) {
      return undefined;
    }

    return entry.instance as T;
  }

  /**
   * 功能 (What): 创建服务实例
   * 输入 (Input): 服务名称和服务条目
   * 输出 (Output): 服务实例
   * 副作用 (Side-effects): 调用工厂函数创建实例
   */
  private async createInstance<T>(name: string, entry: ServiceEntry<T>): Promise<T> {
    try {
      const result = entry.factory();
      return result instanceof Promise ? await result : result;
    } catch (error) {
      throw new Error(`[ServiceRegistry] 创建服务 '${name}' 时发生错误: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 功能 (What): 检查服务是否已注册
   * 输入 (Input): 服务名称
   * 输出 (Output): 布尔值表示是否已注册
   * 副作用 (Side-effects): 无
   */
  public has(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * 功能 (What): 检查服务是否已初始化
   * 输入 (Input): 服务名称
   * 输出 (Output): 布尔值表示是否已初始化
   * 副作用 (Side-effects): 无
   */
  public isInitialized(name: string): boolean {
    const entry = this.services.get(name);
    return entry ? entry.initialized : false;
  }

  /**
   * 功能 (What): 获取所有已注册的服务名称
   * 输入 (Input): 无
   * 输出 (Output): 服务名称数组
   * 副作用 (Side-effects): 无
   */
  public getRegisteredServices(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * 功能 (What): 强制重新初始化指定服务
   * 输入 (Input): 服务名称
   * 输出 (Output): 无
   * 副作用 (Side-effects): 清除缓存的实例，下次获取时重新创建
   */
  public async reinitialize(name: string): Promise<void> {
    const entry = this.services.get(name);
    if (!entry) {
      throw new Error(`[ServiceRegistry] 无法重新初始化未注册的服务: ${name}`);
    }

    if (entry.singleton) {
      entry.instance = undefined;
      entry.initialized = false;
      this.initializationPromises.delete(name);
    }

    if (this.options.enableLogging) {
      logger.info(`[ServiceRegistry] 🔄 服务已重新初始化: ${name}`);
    }
  }

  /**
   * 功能 (What): 重置整个服务注册表
   * 输入 (Input): 无
   * 输出 (Output): 无
   * 副作用 (Side-effects): 清除所有注册的服务和缓存的实例
   */
  public reset(): void {
    this.services.clear();
    this.initializationPromises.clear();
    
    if (this.options.enableLogging) {
      logger.info('[ServiceRegistry] 🧹 服务注册表已重置');
    }
  }

  /**
   * 功能 (What): 获取服务注册表的统计信息
   * 输入 (Input): 无
   * 输出 (Output): 统计信息对象
   * 副作用 (Side-effects): 无
   */
  public getStats() {
    const stats = {
      totalServices: this.services.size,
      initializedServices: 0,
      pendingInitializations: this.initializationPromises.size,
      services: {} as Record<string, { singleton: boolean; initialized: boolean }>
    };

    for (const [name, entry] of this.services.entries()) {
      if (entry.initialized) {
        stats.initializedServices++;
      }
      
      stats.services[name] = {
        singleton: entry.singleton,
        initialized: entry.initialized
      };
    }

    return stats;
  }

  /**
   * 功能 (What): 销毁ServiceRegistry实例（主要用于测试）
   * 输入 (Input): 无
   * 输出 (Output): 无
   * 副作用 (Side-effects): 重置并销毁全局实例
   */
  public static destroy(): void {
    if (ServiceRegistry.instance) {
      ServiceRegistry.instance.reset();
      ServiceRegistry.instance = null as any;
      logger.info('[ServiceRegistry] 🗑️ 全局实例已销毁');
    }
  }
}

// 便捷的全局访问函数
export const getService = <T>(name: string): Promise<T> => {
  return ServiceRegistry.getInstance().get<T>(name);
};

export const getServiceSync = <T>(name: string): T | undefined => {
  return ServiceRegistry.getInstance().getSync<T>(name);
};

export const registerService = <T>(
  name: string, 
  factory: ServiceFactory<T>, 
  singleton: boolean = true
): ServiceRegistry => {
  return ServiceRegistry.getInstance().register(name, factory, singleton);
};
