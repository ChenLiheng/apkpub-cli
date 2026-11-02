import { describe, it, expect } from 'vitest';
import { parseParallel } from './publish.js';
import { ErrorCode } from '../errors/ApkpubError.js';

describe('parseParallel', () => {
  it('未传或为数字字符串时按值解析', () => {
    expect(parseParallel(undefined, 3)).toBe(1);
    expect(parseParallel('2', 3)).toBe(2);
  });

  it('仅传 --parallel 不带值时按渠道数并行', () => {
    expect(parseParallel(true, 4)).toBe(4);
    expect(parseParallel(true, 0)).toBe(1);
  });

  it.each(['abc', '0', '-1', '1.5'])('非法值 %s 抛 INVALID_ARGUMENT', (raw) => {
    expect(() => parseParallel(raw, 3)).toThrow(expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT }));
  });
});
