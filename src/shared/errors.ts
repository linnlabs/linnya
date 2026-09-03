/**
 * @file src/shared/errors.ts
 * 
 * @brief 定义自定义错误类，用于更精确的错误处理。
 *
 * @description
 * 该文件定义了应用中使用的自定义错误类。通过扩展标准 Error 类，
 * 我们可以创建具有特定错误代码、消息格式和附加数据的错误类型。
 * 这使得错误处理更加精确和一致，便于上层模块进行错误识别和处理。
 */

/**
 * 基础应用错误类，所有自定义错误都应该继承自此类
 */
export class AppError extends Error {
  /** 错误代码，用于标识错误类型 */
  code: string;
  
  /** 原始错误，如果这个错误是由另一个错误引起的 */
  cause?: Error;

  /**
   * @param message 错误消息
   * @param code 错误代码
   * @param cause 原始错误（可选）
   */
  constructor(message: string, code: string, cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.cause = cause;
    
    // 确保 instanceof 正常工作
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * 配置错误，当配置缺失或无效时抛出
 */
export class ConfigurationError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 'CONFIGURATION_ERROR', cause);
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

/**
 * 资源未找到错误，当请求的资源不存在时抛出
 */
export class ResourceNotFoundError extends AppError {
  constructor(resource: string, id: string, cause?: Error) {
    super(`Resource not found: ${resource} with id ${id}`, 'RESOURCE_NOT_FOUND', cause);
    Object.setPrototypeOf(this, ResourceNotFoundError.prototype);
  }
}

/**
 * 验证错误，当输入数据不符合预期格式或规则时抛出
 */
export class ValidationError extends AppError {
  /** 验证失败的字段 */
  fields: Record<string, string>;

  constructor(message: string, fields: Record<string, string> = {}, cause?: Error) {
    super(message, 'VALIDATION_ERROR', cause);
    this.fields = fields;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * 外部服务错误，当调用外部API或服务失败时抛出
 */
export class ExternalServiceError extends AppError {
  /** 服务名称 */
  service: string;
  
  /** HTTP状态码（如果适用） */
  statusCode?: number;
  
  /** 服务返回的原始响应（如果有） */
  response?: unknown;

  constructor(service: string, message: string, statusCode?: number, response?: unknown, cause?: Error) {
    super(`${service} service error: ${message}`, 'EXTERNAL_SERVICE_ERROR', cause);
    this.service = service;
    this.statusCode = statusCode;
    this.response = response;
    Object.setPrototypeOf(this, ExternalServiceError.prototype);
  }
}
