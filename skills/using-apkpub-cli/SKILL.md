---
name: using-apkpub-cli
description: >-
  使用 apkpub 命令行工具将已签名 APK 发布到华为、荣耀、小米、OPPO、VIVO
  应用市场及自定义 OSS/HTTP 渠道，并查询审核状态、解析 APK、体检配置。当用户要发布
  APK、上架应用市场、多渠道分发，或提到 apkpub、查询市场审核状态、解析 APK 信息时使用。
---

# 使用 apkpub CLI

apkpub 是 APK 多市场分发命令行工具。按以下规范以**非交互、机器可读**方式调用它。

## 核心原则

1. **先自发现**：首次使用先运行 `apkpub describe --json`，获取命令、渠道、退出码与结果 schema，不要凭记忆假设参数。
2. **始终加 `--json`**：JSON 结果走 stdout，进度与日志走 stderr，便于解析。
3. **非交互**：`publish` 必须加 `--yes` 跳过确认；CI 场景再加 `--no-progress`。
4. **先 dry-run**：真实上传前先用 `--dry-run` 预检渠道、文件匹配与版本校验。
5. **看退出码判定结果**，不要解析文本输出。

## 发布工作流

复制此清单并逐步跟踪：

```
- [ ] 1. apkpub describe --json           # 确认能力与渠道
- [ ] 2. apkpub info <apk> --json         # 确认包名 / versionCode 符合预期
- [ ] 3. apkpub doctor --app <id> --json  # 凭证体检
- [ ] 4. apkpub publish ... --dry-run --json  # 预检
- [ ] 5. apkpub publish ... --yes --json      # 正式发布
- [ ] 6. 检查退出码与 results[].status        # 判定结果
```

## 命令示例

```bash
# 自发现能力清单（命令 / 渠道 / 退出码 / 结果 schema）
apkpub describe --json

# 解析 APK 元数据（包名、versionCode、versionName、大小）
apkpub info ./app-release.apk --json

# 查询线上市场审核状态与最新版本号
apkpub status --app com.example.app --channels huawei,mi --json

# 配置与凭证体检（上传前预检）
apkpub doctor --app com.example.app --json

# 预检（不实际上传）
apkpub publish --app com.example.app --apk ./app.apk --dry-run --json

# 正式发布
apkpub publish --app com.example.app --apk ./app-release.apk \
  --channels huawei,mi --desc "修复已知问题" --yes --json --no-progress
```

### publish 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--app` | 是 | 应用包名（applicationId），须与 APK 内包名一致 |
| `--apk` | 是 | APK 文件（单包）或目录（多渠道包，按文件名标识匹配） |
| `--channels` | 否 | 逗号分隔渠道，省略则发布到配置中全部启用渠道 |
| `--desc` | 否 | 本次更新描述 |
| `--parallel` | 否 | 并发渠道数 |
| `--dry-run` | 否 | 仅预检，不实际上传 |
| `--yes` | 否 | 跳过交互确认（CI / Agent 必加） |
| `--json` / `--no-progress` | 否 | JSON 输出 / 关闭进度条 |

## 解析发布结果

`publish` 输出的 JSON 形如：

```json
{
  "ok": false,
  "dryRun": false,
  "results": [
    { "name": "huawei", "status": "success", "downloadUrl": "https://..." },
    { "name": "mi", "status": "failed",
      "error": { "code": "VERSION_TOO_LOW", "message": "...", "retryable": false } }
  ],
  "summary": { "total": 2, "success": 1, "failed": 1, "skipped": 0 }
}
```

- `results[].status`：`success` / `failed` / `skipped` / `dry_run`。
- 单渠道失败不影响其他渠道，逐个检查 `results[]`。
- 失败时看 `error.code` 与 `error.retryable` 决定是否重试。

## 退出码

| 码 | 含义 | 处理建议 |
| --- | --- | --- |
| 0 | 全部成功 | 完成 |
| 1 | 内部错误 | 上报 stderr 日志 |
| 2 | 参数 / 配置错误 | 检查 `--app` / `--apk` / 渠道名 |
| 3 | 版本校验失败 | 提升 APK versionCode（须大于线上）后重试 |
| 4 | 部分渠道失败 | 检查失败渠道 `error`，可单独重试该渠道 |
| 5 | 全部失败 | 多为鉴权 / 网络问题，先跑 `doctor` 排查 |

## 内置市场渠道

| 渠道 | 标识 | 凭证字段 |
| --- | --- | --- |
| 华为 | `huawei` | client_id, client_secret |
| 荣耀 | `honor` | client_id, client_secret |
| 小米 | `mi` | account, publicKey, privateKey |
| OPPO | `oppo` | client_id, client_secret |
| VIVO | `vivo` | access_key, access_secret |

多渠道包目录模式下，默认文件名标识：`HUAWEI` / `HONOR` / `MI` / `OPPO` / `VIVO`。

## 密钥提供方式

配置文件 `~/.apkpub/apps/{applicationId}.json` 中凭证值支持以下来源（优先级从高到低）：

- 环境变量：`${VAR_NAME}` —— CI / Agent 首选，通过环境注入。
- Keychain：`keychain:account_name`（需安装 keytar）。
- 加密文件：`enc:iv:authTag:cipher`（需设置 `APKPUB_MASTER_KEY`）。
- 明文（会告警，不推荐）。

CI 示例：密钥放入环境变量，配置里用 `${...}` 引用：

```bash
HUAWEI_CLIENT_SECRET=*** MI_PRIVATE_KEY=*** \
apkpub publish --app com.example.app --apk ./out/ \
  --channels huawei,mi --desc "CI 发布" --yes --json --no-progress
```

## 通过 MCP 调用（可选）

若通过 MCP 而非命令行调用，启动 `apkpub mcp`（stdio），暴露工具：
`apkpub_info`、`apkpub_status`、`apkpub_publish`、`apkpub_doctor`，语义与对应 CLI 命令一致。

## 注意事项

- 发布前确保 APK 已签名，且 `info` 输出的包名与 `--app` 一致，否则报 `INVALID_ARGUMENT`。
- 自定义渠道上传地址强制 HTTPS 且禁止内网地址（SSRF 防护），内网 URL 会被拒绝。
- 不要把密钥明文写进命令或配置，优先用环境变量占位符。
