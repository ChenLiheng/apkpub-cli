# 更新日志

本项目所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 新增

- `apkpub update` 命令：升级 CLI 自身（自动识别 npm/pnpm/yarn/bun），并同步内置 Agent skill；支持 `--check` / `--skill-only` / `--force` / `--tag`
- 错误码 `CHANNEL_NOT_SUBMITTABLE`：市场处于审核中时在预检阶段直接拒绝发布
- `publish` 支持 Ctrl+C / SIGTERM 取消（再次触发强制退出），取消信号贯通到各渠道请求与 OSS 分片上传

### 修复

- 自定义渠道 `auth`、`headers` 中的 `${VAR}` / `keychain:` / `enc:` 占位符此前未被解析，现已生效
- `config get` / `config export` 泄露 VIVO `access_secret` 与自定义渠道敏感 headers
- SSRF 防护可被 IPv4 映射 IPv6 地址（如 `[::ffff:127.0.0.1]`）绕过；补充 CGNAT、组播等网段
- OPPO / 荣耀 APK 上传沿用 60s 默认超时，大包必然失败，改为 600s
- 华为更新说明误写入 `appDesc`（应用介绍），改为 `newFeatures`
- 小米接口未返回应用名时误用版本号作为 `appName`
- 华为 token 鉴权失败会被重复重试；编译轮询无法取消且提示文案有误
- 渠道返回非 JSON 响应时抛出含义不明的内部错误
- `--parallel` 非法值导致崩溃；非 TTY 下的错误输出不是 JSON
- APK versionCode 或市场线上版本号无法解析时会静默跳过版本校验
- 自定义 HTTP 渠道 PUT 上传时把整个 APK 读入内存

## [1.0.0] - 2026-06-10

### 新增

- APK 解析（包名 / versionCode / versionName / 大小）
- 内置 5 个市场渠道：华为、荣耀、小米、OPPO、VIVO
- 通用自定义渠道（custom）：支持阿里云 OSS（AK/SK 或 STS）与通用 HTTP（PUT/POST）上传
- 配置管理：`init` / `config list|get|export|import`，配置文件 schema 版本化
- 分层密钥解析：环境变量 > keychain > 加密文件 > 明文（告警）
- 命令：`info` / `status` / `publish` / `doctor` / `channels` / `describe` / `mcp`
- 多渠道包按文件名标识唯一匹配；上传前版本号校验
- 并行上传（`--parallel`）、预检模式（`--dry-run`）
- 统一错误模型 `ApkpubError` 与退出码契约
- MCP server 模式，向 Agent 暴露 `publish/status/info/doctor` 工具
- 安全：输出脱敏、SSRF 防护、模板路径穿越防护、配置文件权限校验

[未发布]: https://github.com/your-org/apkpub-cli/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/your-org/apkpub-cli/releases/tag/v1.0.0
