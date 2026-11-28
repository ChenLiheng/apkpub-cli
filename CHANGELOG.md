# 更新日志

本项目所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.1.0] - 2026-11-28

### 新增

- 根命令 `--help` 顶部展示 Banner（字标、版本号与支持的渠道）
- `publish` 在终端交互模式下发布前展示摘要并请求确认，`--yes` 跳过（JSON / dry-run / 无 TTY 不提示）
- `publish --debug` 输出调试日志（选中文件、APK 信息、线上状态）
- 各市场查询线上状态时遇到网络错误自动重试，并响应取消信号
- 华为、荣耀在同一次发布内复用 access token；单文件发布到多个渠道时 APK 只解析一次
- `apkpub skill install|status|uninstall` 命令，用于管理随包发布的 Agent skill
- CLI 启动时检查 skill 版本，与当前版本不一致时自动同步，覆盖 pnpm 10 / bun 跳过 postinstall、以及后装 Agent 的情况（`CI=true` 或 `APKPUB_SKIP_SKILL_INSTALL=1` 时不同步）；执行 `skill uninstall` 后自动同步与 postinstall 都不再装回，手动 `skill install` 重新开启

### 变更

- **不再支持 Node.js 18**：`engines` 调整为 `>=20`，CI 矩阵改为 Node 20 / 22 / 24
- `status` 有渠道查询失败时退出码不再为 0：部分失败返回 4，全部失败返回 5，JSON 中 `ok` 同步反映
- `status` / `doctor` 命令整体失败时按错误码区分退出码：配置、参数、密钥类错误仍为 2，其余意外错误改为 1（此前一律为 2）
- `status` 各渠道改为并发查询；查询类请求（取 token、查应用与线上状态）超时由 60 秒缩短为 20 秒，市场不可达时不再长时间卡住
- 新增退出码 130：`publish` 确认提示选择「否」时返回（此前为 0），与再次 Ctrl+C 强制退出一致
- 配置文件 JSON 损坏时报 `CONFIG_INVALID`（退出码 2），此前为内部错误（退出码 1）
- `APKPUB_MASTER_KEY` 错误导致解密失败时报 `SECRET_RESOLVE_FAILED`（退出码 2），并给出可读提示
- MCP `apkpub_publish` 与 CLI 校验一致：更新描述为空或无可用渠道时直接报错
- MCP `apkpub_status` 单渠道查询失败只记录在该渠道结果中，不再导致整个工具调用失败
- `status` / `doctor`（CLI 与 MCP）会解析自定义渠道 `auth` / `headers` 中的密钥占位符，与发布链路一致
- 重试仅针对网络错误与标记为可重试的错误，退避时间加入随机抖动；编程错误、参数校验失败不再重试
- CI 中 `pnpm audit` 发现高危漏洞时失败（此前结果被忽略）
- 依赖在现有大版本范围内升级到最新，修复 axios、form-data、MCP SDK 等依赖的已知漏洞
- skill 同步改为按清单（`.apkpub-skill.json`）增量更新：不覆盖用户修改过的文件、不删除用户自己添加的文件，新版本移除的文件会被清理；旧版安装（无清单）首次同步时先备份为 `.bak`；清单中指向 skill 目录外的路径会被忽略，符号链接不覆盖、不删除
- skill 内容按当前 CLI 行为重写：补充非交互初始化、发布前请用户确认、错误码处理与 MCP 工具说明，修正缺少 `--desc` 的示例
- 升级 zod 至 4.x，修复 zod 3 校验超大集合时内存耗尽的高危漏洞（GHSA-mrhx-c7xc-m3w5）

### 修复

- 上传已成功但审计日志写入失败时，渠道被误报为失败
- `--json` 输出后立即退出进程，在 macOS 管道下可能截断 JSON
- 华为查询应用信息时未校验 HTTP 状态与业务码，接口报错时线上版本号被当作 0，任何 APK 都能通过版本校验
- 华为、荣耀的 token 被市场拒绝后仍缓存 10 分钟，重试期间反复使用同一个失效 token
- 共享的 token 请求绑定第一个调用方的取消信号，其取消会让其他等待者一起失败

## [0.0.7] - 2026-11-24

### 新增

- 错误码 `CHANNEL_NOT_SUBMITTABLE`：市场处于审核中时在预检阶段直接拒绝发布
- `publish` 支持 Ctrl+C / SIGTERM 取消（再次触发强制退出），取消信号贯通到各渠道请求与 OSS 分片上传

### 修复

- 荣耀 `objectId` 为 64 位整数，JSON 解析丢失精度导致绑定 APK 报 `objectId is not exists`
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

## [0.0.1] - 2026-06-10

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

[未发布]: https://github.com/ChenLiheng/apkpub-cli/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ChenLiheng/apkpub-cli/releases/tag/v0.1.0
[0.0.7]: https://www.npmjs.com/package/apkpub-cli/v/0.0.7
[0.0.1]: https://github.com/ChenLiheng/apkpub-cli/releases/tag/v0.0.1
