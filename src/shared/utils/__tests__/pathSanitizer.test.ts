/**
 * @file src/shared/utils/__tests__/pathSanitizer.test.ts
 * @description pathSanitizer 单元测试
 */

import { describe, it, expect } from 'vitest';
import { sanitizePathSegment } from '../pathSanitizer';

describe('sanitizePathSegment', () => {
  it('应保留字母、数字、下划线、点、横线', () => {
    expect(sanitizePathSegment('abc_123.test-file')).toBe('abc_123.test-file');
  });

  it('应将非法字符替换为下划线', () => {
    expect(sanitizePathSegment('hello world')).toBe('hello_world');
    expect(sanitizePathSegment('path/to/file')).toBe('path_to_file');
    expect(sanitizePathSegment('name:value')).toBe('name_value');
    expect(sanitizePathSegment('file<>name')).toBe('file__name');
  });

  it('空输入应返回 unknown', () => {
    expect(sanitizePathSegment('')).toBe('unknown');
    expect(sanitizePathSegment('   ')).toBe('unknown');
  });

  it('应正确处理 trim', () => {
    expect(sanitizePathSegment('  hello  ')).toBe('hello');
    expect(sanitizePathSegment('\t\ntest\n\t')).toBe('test');
  });

  it('应支持 maxLength 参数', () => {
    const longInput = 'a'.repeat(200);
    expect(sanitizePathSegment(longInput, 100)).toBe('a'.repeat(100));
    expect(sanitizePathSegment(longInput, 50)).toBe('a'.repeat(50));
  });

  it('maxLength 不影响短字符串', () => {
    expect(sanitizePathSegment('short', 100)).toBe('short');
  });

  it('maxLength 为 undefined 时不截断', () => {
    const longInput = 'a'.repeat(200);
    expect(sanitizePathSegment(longInput)).toBe(longInput);
  });

  it('应正确处理中文等 Unicode 字符（替换为下划线）', () => {
    expect(sanitizePathSegment('测试文件')).toBe('____');
    expect(sanitizePathSegment('test_中文_name')).toBe('test____name');
  });

  it('应正确处理特殊 ID 格式', () => {
    // UUID 格式
    expect(sanitizePathSegment('550e8400-e29b-41d4-a716-446655440000'))
      .toBe('550e8400-e29b-41d4-a716-446655440000');
    
    // nanoid 格式
    expect(sanitizePathSegment('V1StGXR8_Z5jdHi6B-myT'))
      .toBe('V1StGXR8_Z5jdHi6B-myT');
  });
});

