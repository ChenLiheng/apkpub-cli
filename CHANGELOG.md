# 更新日志

本项目所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

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

[未发布]: https://github.com/youlai/apkpub-cli/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/youlai/apkpub-cli/releases/tag/v1.0.0
