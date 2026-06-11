# apkpub-cli

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

APK 多市场分发 CLI 工具。支持将已签名的 APK 一键发布到华为、小米、OPPO、VIVO、荣耀应用市场，以及可配置的自定义上传渠道（阿里云 OSS / 通用 HTTP）。面向 CI/CD、本地命令行与 AI Agent（内置 MCP server）。

## 目录

- [apkpub-cli](#apkpub-cli)
  - [目录](#目录)
  - [安装](#安装)
  - [快速开始](#快速开始)
    - [1. 创建应用配置](#1-创建应用配置)
    - [2. 解析 APK](#2-解析-apk)
    - [3. 查询市场状态](#3-查询市场状态)
    - [4. 发布 APK](#4-发布-apk)
    - [5. 配置体检](#5-配置体检)
  - [配置管理](#配置管理)
  - [密钥管理](#密钥管理)
  - [自定义渠道（通用上传）](#自定义渠道通用上传)
  - [内置市场渠道](#内置市场渠道)
  - [Agent / MCP 集成](#agent--mcp-集成)
    - [Cursor MCP 配置示例](#cursor-mcp-配置示例)
  - [CI 集成示例](#ci-集成示例)
  - [退出码](#退出码)
  - [开发](#开发)
  - [安全说明](#安全说明)
  - [贡献](#贡献)
  - [许可证](#许可证)

## 安装

```bash
pnpm install
pnpm build
pnpm link --global  # 或 npm link
```

## 快速开始

### 1. 创建应用配置

```bash
# 交互式
apkpub init

# 非交互式（CI/Agent）
apkpub init --name "我的应用" --app com.example.app --channels huawei,mi
```

### 2. 解析 APK

```bash
apkpub info ./app-release.apk
apkpub info ./app-release.apk --json
```

### 3. 查询市场状态

```bash
apkpub status --app com.example.app
apkpub status --app com.example.app --channels huawei,mi --json
```

### 4. 发布 APK

```bash
# 单包模式
apkpub publish --app com.example.app --apk ./app-release.apk \
  --channels huawei,mi --desc "修复已知问题" --yes

# 多渠道包模式（目录下按文件名标识匹配）
apkpub publish --app com.example.app --apk ./apks/ \
  --channels huawei,mi,oppo,vivo,honor --desc "版本更新"

# 预检模式（不实际上传）
apkpub publish --app com.example.app --apk ./app.apk --dry-run --json
```

### 5. 配置体检

```bash
apkpub doctor --app com.example.app --json
```

## 配置管理

配置文件位于 `~/.apkpub/apps/{applicationId}.json`。

```bash
apkpub config list
apkpub config get com.example.app
apkpub config export com.example.app -o config.json   # 默认剥离密钥
apkpub config import config.json
```

## 密钥管理

优先级：`环境变量 > keychain > 加密文件 > 明文（告警）`

```json
{
  "params": [
    { "name": "client_secret", "value": "${HUAWEI_CLIENT_SECRET}" },
    { "name": "privateKey", "value": "keychain:mi_private_key" }
  ]
}
```

- 环境变量：`${VAR_NAME}`
- Keychain：`keychain:account_name`（需安装 keytar）
- 加密文件：`enc:iv:authTag:cipher`（需设置 `APKPUB_MASTER_KEY`）

## 自定义渠道（通用上传）

支持 OSS 和 HTTP 两种上传方式，可配置多个自定义渠道：

```json
{
  "name": "myOss",
  "type": "custom",
  "enable": true,
  "uploadType": "oss",
  "fileNameIdentify": "myOss",
  "endpoint": "https://oss-cn-beijing.aliyuncs.com",
  "bucket": "my-bucket",
  "auth": {
    "mode": "sts",
    "stsTokenUrl": "https://your-api.com/v1/getSTSToken",
    "signKey": "${STS_SIGN_KEY}",
    "contextB": "{}"
  },
  "objectKeyTemplate": "apps/{appId}/{fileName}",
  "downloadUrlTemplate": "https://cdn.example.com/{objectKey}"
}
```

HTTP 上传示例：

```json
{
  "name": "myCdn",
  "type": "custom",
  "enable": true,
  "uploadType": "http",
  "uploadUrl": "https://cdn.example.com/upload/{fileName}",
  "method": "PUT",
  "objectKeyTemplate": "apps/{appId}/{fileName}",
  "downloadUrlTemplate": "https://cdn.example.com/{objectKey}"
}
```

## 内置市场渠道

| 渠道 | 标识     | 凭证字段                       |
| ---- | -------- | ------------------------------ |
| 华为 | `huawei` | client_id, client_secret       |
| 荣耀 | `honor`  | client_id, client_secret       |
| 小米 | `mi`     | account, publicKey, privateKey |
| OPPO | `oppo`   | client_id, client_secret       |
| VIVO | `vivo`   | access_key, access_secret      |

多渠道包文件名标识（默认）：HUAWEI / HONOR / MI / OPPO / VIVO

## Agent / MCP 集成

```bash
# 机器可读自描述
apkpub describe --json

# MCP Server 模式
apkpub mcp
```

MCP 暴露工具：`apkpub_info`、`apkpub_status`、`apkpub_publish`、`apkpub_doctor`

### Cursor MCP 配置示例

```json
{
  "mcpServers": {
    "apkpub": {
      "command": "apkpub",
      "args": ["mcp"]
    }
  }
}
```

## CI 集成示例

```yaml
- name: Publish APK
  env:
    HUAWEI_CLIENT_SECRET: ${{ secrets.HUAWEI_CLIENT_SECRET }}
    MI_PRIVATE_KEY: ${{ secrets.MI_PRIVATE_KEY }}
  run: |
    apkpub publish \
      --app com.example.app \
      --apk ./build/outputs/apk/release/ \
      --channels huawei,mi \
      --desc "CI 自动发布" \
      --yes --json --no-progress
```

## 退出码

| 码  | 含义          |
| --- | ------------- |
| 0   | 全部成功      |
| 2   | 参数/配置错误 |
| 3   | 版本校验失败  |
| 4   | 部分渠道失败  |
| 5   | 全部失败      |

## 开发

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## 安全说明

- 配置目录权限：`~/.apkpub/` 0700，配置文件 0600
- `config export` 默认剥离密钥
- 日志与 JSON 输出自动脱敏
- 自定义渠道 URL 强制 HTTPS 并禁止内网地址（SSRF 防护）

完整安全策略与漏洞上报方式见 [SECURITY.md](SECURITY.md)。

## 贡献

欢迎提交 Issue 与 Pull Request！参与前请阅读：

- [贡献指南 CONTRIBUTING.md](CONTRIBUTING.md)
- [行为准则 CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [更新日志 CHANGELOG.md](CHANGELOG.md)

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 开源，详见 [NOTICE](NOTICE)。
