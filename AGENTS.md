# AGENTS.md — apkpub-cli 工程指南

> 面向 AI Agent 与开发者的项目协作指南。修改代码前请先通读本文件。

## 1. 项目定位

`apkpub-cli` 是一个 **APK 多市场分发命令行工具**：一条命令把已签名的 APK 发布到华为 / 小米 / OPPO / VIVO / 荣耀应用市场，以及可配置的自定义上传渠道（阿里云 OSS / 通用 HTTP）。

同时面向三类调用方设计：

- **人类**：本地交互式使用（`@inquirer/prompts` 提供向导）。
- **CI/CD**：非交互式、`--json` 机器可读输出、稳定的退出码。
- **AI Agent**：内置 `describe`（自描述）与 `mcp`（MCP Server）两种自发现 / 调用入口。

## 2. 技术栈与常用命令

- 运行时：Node.js `>=18`，纯 **ESM**（`"type": "module"`）。
- 语言：TypeScript（严格类型，禁止隐式 `any`）。
- 包管理：**pnpm**（`packageManager: pnpm@10.x`）。
- 打包：`tsup`（入口 `src/bin/apkpub.ts` → `dist/apkpub.js`，带 `#!/usr/bin/env node` banner）。
- 测试：`vitest` + `nock`（HTTP mock）。
- 校验：`zod`。

```bash
pnpm install        # 安装依赖
pnpm build          # tsup 打包到 dist/
pnpm dev            # tsup --watch
pnpm test           # vitest run
pnpm typecheck      # tsc --noEmit
pnpm start          # 运行 dist/apkpub.js
```

CI（`.github/workflows/ci.yml`）在 Node 18/20/22 三个版本上执行 `typecheck → test → build`，外加 `pnpm audit`。**提交前务必保证 `pnpm typecheck` 与 `pnpm test` 通过。**

> 关键约束：源码用 ESM 相对导入时**必须带 `.js` 后缀**（如 `import { logger } from '../utils/logger.js'`），即便源文件是 `.ts`。这是全仓库统一约定，新增导入请遵守。

## 3. 目录结构与分层

```
src/
├── bin/apkpub.ts        # CLI 入口，注册所有子命令（commander）
├── cli/                 # 各子命令的注册与参数解析（薄层，只做编排）
│   ├── init / config / info / publish / status / channels / doctor / describe / mcp
├── core/                # 编排核心（与具体渠道、UI 解耦）
│   ├── Dispatcher.ts    # 多渠道并发分发编排器
│   ├── TaskLauncher.ts  # 单渠道任务：选文件 → 解析 APK → 注入配置
│   ├── versionCheck.ts  # 包名匹配 / 版本号校验
│   └── result.ts        # 结果聚合、退出码、ChannelResult/PublishResult 模型
├── channels/            # 渠道实现（核心扩展点）
│   ├── Channel.ts       # Channel 接口定义（所有渠道的契约）
│   ├── registry.ts      # 渠道注册表 + 凭证元信息（describe 用）
│   ├── huawei|honor|mi|oppo|vivo/  # 内置市场渠道
│   └── custom/          # 自定义渠道（oss.ts / http.ts）
├── config/              # 配置 schema（zod）与持久化（~/.apkpub）
├── secrets/resolver.ts  # 密钥解析（env / keychain / 加密 / 明文）
├── signers/             # 签名工具（hmac / md5 / rsa），各带 *.test.ts
├── apk/ApkParser.ts     # APK 元数据解析（app-info-parser 封装）
├── mcp/server.ts        # MCP Server（stdio）
├── errors/ApkpubError.ts# 统一错误模型 + 错误码枚举
└── utils/               # http(含 SSRF 防护/重试) / logger / output / redaction / template / files
```

分层原则：`cli/` 只做参数解析与输出 → 调用 `core/` 编排 → `core/` 通过 `Channel` 接口驱动 `channels/`。**新增功能时不要让 `core/` 反向依赖具体渠道，也不要在 `channels/` 里直接读 CLI 参数。**

## 4. 核心数据流（publish）

`cli/publish.ts` 与 `mcp/server.ts` 共用同一条主链路：

```
loadConfig(appId)                       # config/store.ts 读取 ~/.apkpub/apps/{appId}.json
  → resolveChannels(appConfig, names)   # channels/registry.ts 解析启用的渠道
  → new Dispatcher().dispatch(...)      # core/Dispatcher.ts 并发编排（p-limit 控制并行度）
       每个渠道：
         TaskLauncher.getRawParams       # 取出原始参数
         → resolveConfigSecrets          # secrets/resolver.ts 解析密钥占位符
         → launcher.injectConfig         # 注入解析后的配置
         → launcher.selectFile           # 单文件 / 目录按 fileNameIdentify 匹配
         → launcher.prepare              # ApkParser 解析 APK 元数据
         → checkPackageMatch             # 包名必须与配置一致
         → channel.getMarketState?       # 查线上版本
         → checkVersion                  # versionCode 必须 > 线上
         → (dryRun ? 返回 dry_run : channel.upload(ctx))
         → writeAuditLog                 # 审计日志
  → aggregateResults → getExitCode       # 聚合结果 + 计算退出码
```

`Dispatcher` 对**每个渠道独立 try/catch**：单渠道失败转成 `ChannelResult{status:'failed'}`，不影响其他渠道，最终由 `aggregateResults` 汇总。

## 5. 关键抽象

### Channel 接口（`channels/Channel.ts`）— 最重要的扩展契约

```ts
interface Channel {
  name: string;                    // 唯一标识，对应配置里的 channel.name
  label: string;                   // 展示名（如「华为」）
  type: 'market' | 'custom';
  fileNameIdentify: string;        // 多渠道目录模式下的文件名匹配标识
  credentialSchema: ZodSchema;     // 凭证校验
  getMarketState?(appId, config): Promise<MarketInfo | undefined>;  // 查线上状态/版本
  upload(ctx: UploadContext): Promise<UploadResult>;               // 上传主流程
  validateCredentials?(config): Promise<void>;                     // doctor 预检
}
```

`UploadContext` 提供 `apkInfo / filePath / desc / config / dryRun / onProgress / signal`。渠道实现通过 `onProgress({ step, percent })` 上报进度，通过 `signal`（AbortSignal）响应取消。

### Dispatcher / TaskLauncher

- `Dispatcher`：负责并发（`p-limit`）、统一异常归集、审计日志。是渠道无关的纯编排。
- `TaskLauncher`：单渠道生命周期管理（文件选择、APK 解析、配置注入）。市场渠道与自定义渠道在 `injectConfig` 中分别处理参数来源。

## 6. 扩展指南：新增一个市场渠道

1. 新建 `src/channels/<name>/index.ts`，用 `zod` 定义 `credSchema`，导出符合 `Channel` 接口的对象。
2. 上传流程参照 `huawei/index.ts`：每个网络步骤用 `createHttpClient()`，关键步骤包 `withRetry`，每步调用 `ctx.onProgress({ step })`，失败抛 `ApkpubError`（带 `channel` / `step` / `retryable`）。
3. 在 `channels/registry.ts` 的 `BUILTIN_MARKET_CHANNELS` 数组中注册，并在 `MARKET_CREDENTIALS` 中补充凭证字段（供 `describe` 与 `init` 向导使用）。
4. 在 `cli/describe.ts` 的 `COMMANDS`（如涉及）与 README 渠道表中同步补充。
5. 为签名 / 工具逻辑补充 `*.test.ts`（参照 `signers/*.test.ts`），用 `nock` mock HTTP。

> 自定义渠道无需写新文件：通过配置 `type: 'custom'` + `uploadType: 'oss'|'http'`，由 `channels/custom/` 的 `createCustomChannel` 动态生成。

## 7. 配置与密钥

- 配置位置：`~/.apkpub/apps/{applicationId}.json`（目录 `0700`，文件 `0600`）；schema 见 `config/schema.ts`，版本号 `CURRENT_SCHEMA_VERSION`，旧配置经 `migrateConfig` 升级。
- 密钥解析优先级（`secrets/resolver.ts`）：**环境变量 `${VAR}` > keychain `keychain:account` > 加密 `enc:iv:tag:cipher`（需 `APKPUB_MASTER_KEY`）> 明文（告警）**。
- 加密算法：`aes-256-gcm` + `scryptSync` 派生密钥。
- 导出配置（`config export`）默认经 `stripSecrets` 剥离敏感字段。

## 8. 错误处理与退出码

- 统一抛 `ApkpubError`（`errors/ApkpubError.ts`），携带 `code`（`ErrorCode` 枚举）、`channel`、`step`、`retryable`。网络类错误（`NETWORK_ERROR/TIMEOUT/CHANNEL_UPLOAD_FAILED`）默认可重试。
- 非 `ApkpubError` 的异常用 `toApkpubError` 包装成 `INTERNAL`。
- 退出码（`core/result.ts` 的 `ExitCode` + `getExitCode`）：

| Code | 含义                                            |
| ---- | ----------------------------------------------- |
| 0    | 全部成功                                        |
| 1    | 内部错误                                        |
| 2    | 参数/配置错误                                   |
| 3    | 版本校验失败（全部因 `VERSION_TOO_LOW` 失败时） |
| 4    | 部分渠道失败                                    |
| 5    | 全部失败                                        |

## 9. 安全约束（修改时必须保持）

- **SSRF 防护**：所有外发上传 / 回调 URL 必须经 `utils/http.ts` 的 `assertSafeUrl`——仅允许 http/https，且拦截 localhost / 私网网段（10./172.16-31./192.168./169.254. 等）。
- **路径穿越防护**：模板渲染走 `utils/template.ts` 的 `renderTemplate`/`sanitizePath`，禁止 `..` 与绝对路径。
- **日志脱敏**：`utils/redaction.ts` 对敏感键（secret/token/privateKey/signKey…）自动 `***REDACTED***`，`logger` 输出经 `redactMessage` 过滤 Bearer / 密钥。新增日志不要绕过 logger 直接打印密钥。
- **输出分流**：JSON 结果走 **stdout**（`printJson`），进度/表格/日志走 **stderr**——保证 `--json` 输出可被管道安全解析。

## 10. Agent / MCP 集成

- `apkpub describe --json`：输出命令、渠道、退出码、`publishResult` JSON schema 的机器可读自描述（`cli/describe.ts`）。Agent 应先调用它进行能力发现。
- `apkpub mcp`：以 stdio 启动 MCP Server（`mcp/server.ts`），暴露 4 个工具：`apkpub_info` / `apkpub_status` / `apkpub_publish` / `apkpub_doctor`。MCP 工具复用 `core/` 与 `channels/`，与 CLI 同源。
- 新增 CLI 能力若希望对 Agent 可见，需同步在 `describe.ts` 与 `mcp/server.ts` 注册。

## 11. 编码规范约定

- 注释一律用**中文（UTF-8）**，只说明功能，不写「按需求修改」类描述。
- import 全部置于文件顶部，禁止函数体内内联 import（仓库已有 `await import()` 用于可选依赖 keytar / 动态 fs，属既有约定，新增按需谨慎）。
- 对 discriminated union / enum 的 `switch` 用 `never` 兜底（见 always-applied 规则）。
- 修改既有函数时**先理解原逻辑，在原基础上扩展，保留原有行为**，不要随意删除。专注当前任务，勿动无关功能。
- 进度回调、HTTP 客户端、错误抛出等请复用 `utils/` 与 `errors/` 既有工具，不要另起炉灶。

## 12. 测试要点

- 单元测试集中在 `signers/*.test.ts`、`utils/template.test.ts`；HTTP 交互用 `nock` mock，避免真实网络。
- 渠道上传逻辑（`getMarketState`/`upload`）建议补充 mock 测试，覆盖鉴权失败、版本过低、上传非 2xx 等分支。
- 提交前跑 `pnpm typecheck && pnpm test`。
