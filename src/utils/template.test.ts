import { describe, it, expect } from 'vitest';
import { renderTemplate, sanitizePath } from './template.js';
import { ApkpubError } from '../errors/ApkpubError.js';

describe('renderTemplate', () => {
  it('应替换占位符', () => {
    const result = renderTemplate('apps/{appId}/{fileName}', {
      appId: 'com.test',
      versionName: '1.0',
      versionCode: 10,
      fileName: 'app.apk',
    });
    expect(result).toBe('apps/com.test/app.apk');
  });

  it('应拒绝路径穿越', () => {
    expect(() => sanitizePath('../etc/passwd')).toThrow(ApkpubError);
  });
});
