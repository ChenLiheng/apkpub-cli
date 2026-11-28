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

1. **先自发现**：首次使用先运行 `apkpub describe --json`，获取命令、渠道、凭证字段、退出码与结果 schema，不要凭记忆假设参数。
2. **始终加 `--json`**：JSON 结果走 stdout，进度与日志走 stderr，只解析 stdout。
3. **先 dry-run，再请用户确认，最后正式发布**：正式发布会把版本提交到应用市场审核，**无法撤回**。dry-run 通过后，必须把包名、versionName(versionCode)、目标渠道、更新描述告诉用户，得到明确同意后才去掉 `--dry-run`。
4. **`publish` 必须带 `--desc`**（除非配置里设置了 `extension.updateDesc`），dry-run 也一样，否则直接报 `INVALID_ARGUMENT`。
5. **看退出码与 JSON 判定结果**，不要解析文本输出。

## 发布工作流

复制此清单并逐步跟踪：

```
- [ ] 1. apkpub describe --json                      # 确认能力、渠道与凭证字段
- [ ] 2. apkpub info <apk> --json                    # 确认包名 / versionCode
- [ ] 3. apkpub doctor --app <id> --json             # 凭证体检；CONFIG_NOT_FOUND 时先建配置（见下文）
- [ ] 4. apkpub status --app <id> --json             # 确认线上版本与是否在审核中
- [ ] 5. apkpub publish ... --desc "..." --dry-run --json --yes   # 预检
- [ ] 6. 向用户确认版本、渠道、描述                   # 必须得到明确同意
- [ ] 7. apkpub publish ... --desc "..." --json --yes --no-progress  # 正式发布
- [ ] 8. 检查退出码与 results[].status；只对失败渠道按需重试
```

## 命令示例

```bash
# 自发现能力清单
apkpub describe --json

# 解析 APK 元数据
apkpub info ./app-release.apk --json

# 凭证体检
apkpub doctor --app com.example.app --json

# 查询线上审核状态与最新版本号
apkpub status --app com.example.app --channels huawei,mi --json

# 预检（不实际上传）
apkpub publish --app com.example.app --apk ./app-release.apk \
  --channels huawei,mi --desc "修复已知问题" --dry-run --json --yes

# 正式发布（用户确认后）
apkpub publish --app com.example.app --apk ./app-release.apk \
  --channels huawei,mi --desc "修复已知问题" --json --yes --no-progress
```

### publish 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--app` | 是 | 应用包名（applicationId），须与 APK 内包名一致 |
| `--apk` | 是 | APK 文件（单包）或目录（多渠道包，按文件名标识匹配，每个渠道须唯一匹配一个文件） |
| `--desc` | 是* | 更新描述；*仅当配置中有 `extension.updateDesc` 时可省略 |
| `--channels` | 否 | 逗号分隔渠道，省略则发布到配置中全部启用渠道 |
| `--parallel [n]` | 否 | 并发渠道数，默认 1；只写 `--parallel` 不带值表示全部渠道并行 |
| `--dry-run` | 否 | 仅预检（文件匹配、包名、版本号、审核状态），不上传 |
| `--yes` | 否 | 跳过确认提示。提示只在交互终端出现，无 TTY 时不会阻塞；建议始终加上 |
| `--json` / `--no-progress` | 否 | JSON 输出 / 关闭进度输出 |
| `--debug` | 否 | 在 stderr 输出调试日志（选中文件、APK 信息、线上状态） |

## 没有配置时：非交互初始化

`doctor` / `publish` 返回 `CONFIG_NOT_FOUND` 时，先创建配置。**必须传 `--channels`**，否则不会启用任何渠道：

```bash
apkpub init --name "示例应用" --apk ./app-release.apk --channels huawei,mi --json
# 或用 --app com.example.app 代替 --apk
```

非交互模式下，凭证会写成环境变量占位符（如 `${HUAWEI_CLIENT_SECRET}`），输出的 `nextSteps.requiredEnv` 列出需要设置的变量：

```json
{ "ok": true,
  "config": { "applicationId": "com.example.app", "channels": ["huawei", "mi"] },
  "nextSteps": { "requiredEnv": ["HUAWEI_CLIENT_ID", "HUAWEI_CLIENT_SECRET", "MI_ACCOUNT", "MI_PUBLICKEY", "MI_PRIVATEKEY"] } }
```

把 `requiredEnv` 告诉用户，请用户自己设置这些环境变量。**不要向用户索要密钥明文，也不要把密钥写进命令行或配置文件。**

修改已有配置用 `config set`，参数值同样使用占位符：

```bash
apkpub config set com.example.app --channel oppo --enable true \
  --param 'client_id=${OPPO_CLIENT_ID}' --param 'client_secret=${OPPO_CLIENT_SECRET}' --json
```

输出中 `client_secret` 等敏感字段显示为空字符串是脱敏展示，实际已保存；用 `doctor` 验证即可。

## 解析结果

### publish 逐渠道结果

```json
{
  "ok": false,
  "dryRun": false,
  "results": [
    { "name": "huawei", "label": "华为", "status": "success", "downloadUrl": "https://..." },
    { "name": "mi", "label": "小米", "status": "failed",
      "error": { "code": "VERSION_TOO_LOW", "message": "...", "step": "...", "retryable": false } }
  ],
  "summary": { "total": 2, "success": 1, "failed": 1, "skipped": 0 }
}
```

- `results[].status`：`success` / `failed` / `skipped` / `dry_run`。
- 单渠道失败不影响其他渠道，逐个检查 `results[]`。

### 命令整体失败

配置不存在、参数错误等在进入渠道之前就失败时，输出**没有 `results`**：

```json
{ "ok": false, "error": { "code": "CONFIG_NOT_FOUND", "message": "...", "retryable": false } }
```

先判断有没有 `error` 字段，再读 `results`。

### status / doctor

- `status`：`{ "ok": bool, "results": [{ "name", "label", "state", "versionCode", "versionName", "error"? }] }`，`state` 为 `online` / `reviewing` / `rejected` / `unknown`，自定义渠道为 `n/a`。
- `doctor`：`{ "ok": bool, "app": "...", "checks": [{ "channel", "ok", "message" }] }`。

## 错误码处理

| 错误码 | 处理 |
| --- | --- |
| `CONFIG_NOT_FOUND` | 按上文非交互初始化 |
| `CONFIG_INVALID` | 配置文件损坏，请用户检查 `~/.apkpub/apps/<id>.json` |
| `SECRET_RESOLVE_FAILED` | 环境变量未设置或 `APKPUB_MASTER_KEY` 不对，请用户补齐，不要重试 |
| `INVALID_ARGUMENT` | 检查 `--desc`、包名是否与 APK 一致等参数 |
| `APK_NOT_FOUND` / `APK_AMBIGUOUS` | 目录模式下文件名未匹配或匹配多个，调整文件名或改为单文件 |
| `VERSION_TOO_LOW` | versionCode 必须大于线上版本，需重新打包，不要重试 |
| `CHANNEL_NOT_SUBMITTABLE` | 该市场正在审核上一个版本，等待审核结束，不要重试 |
| `CHANNEL_AUTH_FAILED` | 凭证无效，先跑 `doctor` 排查 |
| `retryable: true` 的错误 | 网络类问题，可稍后**只对该渠道**用 `--channels <name>` 重试 |

**不要整批重发**：已成功的渠道再次发布会重复提交。重试时只带失败渠道。

## 退出码

| 码 | 含义 | 处理建议 |
| --- | --- | --- |
| 0 | 全部成功 | 完成 |
| 1 | 内部错误 | 上报 stderr 日志 |
| 2 | 参数 / 配置 / 密钥错误 | 看 `error.code`，按上表处理 |
| 3 | 版本校验失败（全部渠道都因版本号过低失败） | 提升 versionCode 后重新打包 |
| 4 | 部分渠道失败（publish / status） | 检查失败渠道，按需单独重试 |
| 5 | 全部失败（publish / status）；doctor 有渠道未通过 | 多为鉴权 / 网络问题，先跑 `doctor` |
| 130 | 用户取消（确认提示选择否或强制中断） | 未发布或已中断，按用户意图处理 |

## 内置市场渠道

| 渠道 | 标识 | 凭证字段 | 默认环境变量 |
| --- | --- | --- | --- |
| 华为 | `huawei` | client_id, client_secret | `HUAWEI_CLIENT_ID`, `HUAWEI_CLIENT_SECRET` |
| 荣耀 | `honor` | client_id, client_secret | `HONOR_CLIENT_ID`, `HONOR_CLIENT_SECRET` |
| 小米 | `mi` | account, publicKey, privateKey | `MI_ACCOUNT`, `MI_PUBLICKEY`, `MI_PRIVATEKEY` |
| OPPO | `oppo` | client_id, client_secret | `OPPO_CLIENT_ID`, `OPPO_CLIENT_SECRET` |
| VIVO | `vivo` | access_key, access_secret | `VIVO_ACCESS_KEY`, `VIVO_ACCESS_SECRET` |

多渠道包目录模式下，默认文件名标识：`HUAWEI` / `HONOR` / `MI` / `OPPO` / `VIVO`（不区分大小写，可用 `fileNameIdentify` 参数覆盖）。

## 密钥提供方式

配置中的凭证值支持以下来源（优先级从高到低）：

- 环境变量：`${VAR_NAME}` —— CI / Agent 首选。
- Keychain：`keychain:account_name`（需安装 keytar）。
- 加密值：`enc:v2:salt:iv:authTag:cipher`（需设置 `APKPUB_MASTER_KEY`）。
- 明文（会告警，不推荐）。

## 通过 MCP 调用（可选）

运行 `apkpub mcp`（stdio）启动 MCP Server，暴露 5 个工具，语义与 CLI 一致：

| 工具 | 对应命令 | 参数 |
| --- | --- | --- |
| `apkpub_describe` | `describe` | 无 |
| `apkpub_info` | `info` | `apk` |
| `apkpub_status` | `status` | `app`, `channels?` |
| `apkpub_doctor` | `doctor` | `app` |
| `apkpub_publish` | `publish` | `app`, `apk`, `desc`, `channels?`, `dryRun?`, `parallel?` |

`apkpub_publish` 同样要求 `desc` 非空，并且同样遵守"先 `dryRun: true`、请用户确认、再正式发布"的流程。工具失败时返回 `isError: true`，内容为 `{ "error": "...", "code": "..." }`。

## 注意事项

- 发布前确保 APK 已签名，且 `info` 输出的包名与 `--app` 一致。
- 自定义渠道的上传地址禁止指向内网（SSRF 防护）。
- 用户中途要求取消时，向进程发送 SIGINT（Ctrl+C）会取消进行中的上传；已提交到市场的渠道无法撤回。
