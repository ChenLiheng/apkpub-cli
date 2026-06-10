import { createHmac } from 'node:crypto';

/** HMAC-SHA256 签名，返回十六进制小写 */
export function hmacSha256(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data, 'utf8').digest('hex');
}

/** 按 key 排序拼接参数后签名（OPPO 风格） */
export function signSortedParams(params: Record<string, string>, secret: string): string {
  const keys = Object.keys(params).sort();
  const pairs = keys
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .map((k) => `${k}=${params[k]}`);
  return hmacSha256(pairs.join('&'), secret);
}

/** VIVO 风格签名参数生成 */
export function vivoSignParams(
  accessKey: string,
  accessSecret: string,
  method: string,
  originParams: Record<string, string>,
): Record<string, string> {
  const params: Record<string, string> = { ...originParams };
  params.access_key = accessKey;
  params.timestamp = String(Date.now());
  params.method = method;
  params.v = '1.0';
  params.sign_method = 'HMAC-SHA256';
  params.format = 'json';
  params.target_app_key = 'developer';
  const keys = Object.keys(params).sort();
  const data = keys.map((k) => `${k}=${params[k]}`).join('&');
  params.sign = hmacSha256(data, accessSecret);
  return params;
}
