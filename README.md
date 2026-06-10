# apkpub-cli

[![CI](https://github.com/youlai/apkpub-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/youlai/apkpub-cli/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/apkpub-cli.svg)](https://www.npmjs.com/package/apkpub-cli)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**English** | [简体中文](README_zh.md)

APK multi-market distribution CLI. Publish a signed APK to the Huawei, Xiaomi, OPPO, VIVO, and Honor app stores, plus configurable custom upload channels (Aliyun OSS / generic HTTP) — all in one command. Built for CI/CD, local use, and AI agents via a built-in MCP server.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration Management](#configuration-management)
- [Secret Management](#secret-management)
- [Custom Channels (Generic Upload)](#custom-channels-generic-upload)
- [Built-in Market Channels](#built-in-market-channels)
- [Agent / MCP Integration](#agent--mcp-integration)
- [CI Integration Example](#ci-integration-example)
- [Exit Codes](#exit-codes)
- [Development](#development)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

## Installation

```bash
pnpm install
pnpm build
pnpm link --global  # or npm link
```

## Quick Start

### 1. Create an app configuration

```bash
# Interactive
apkpub init

# Non-interactive (CI/Agent)
apkpub init --name "My App" --app com.example.app --channels huawei,mi
```

### 2. Parse an APK

```bash
apkpub info ./app-release.apk
apkpub info ./app-release.apk --json
```

### 3. Query market status

```bash
apkpub status --app com.example.app
apkpub status --app com.example.app --channels huawei,mi --json
```

### 4. Publish an APK

```bash
# Single-package mode
apkpub publish --app com.example.app --apk ./app-release.apk \
  --channels huawei,mi --desc "Bug fixes" --yes

# Multi-channel package mode (matched by filename identifier within a directory)
apkpub publish --app com.example.app --apk ./apks/ \
  --channels huawei,mi,oppo,vivo,honor --desc "Version update"

# Dry-run mode (no actual upload)
apkpub publish --app com.example.app --apk ./app.apk --dry-run --json
```

### 5. Configuration health check

```bash
apkpub doctor --app com.example.app --json
```

## Configuration Management

Configuration files live at `~/.apkpub/apps/{applicationId}.json`.

```bash
apkpub config list
apkpub config get com.example.app
apkpub config export com.example.app -o config.json   # strips secrets by default
apkpub config import config.json
```

## Secret Management

Resolution priority: `environment variable > keychain > encrypted file > plaintext (warning)`

```json
{
  "params": [
    { "name": "client_secret", "value": "${HUAWEI_CLIENT_SECRET}" },
    { "name": "privateKey", "value": "keychain:mi_private_key" }
  ]
}
```

- Environment variable: `${VAR_NAME}`
- Keychain: `keychain:account_name` (requires keytar)
- Encrypted file: `enc:iv:authTag:cipher` (requires `APKPUB_MASTER_KEY`)

## Custom Channels (Generic Upload)

Supports both OSS and HTTP upload methods, and you can define multiple custom channels:

```json
{
  "name": "youlai",
  "type": "custom",
  "enable": true,
  "uploadType": "oss",
  "fileNameIdentify": "youlai",
  "endpoint": "https://oss-cn-beijing.aliyuncs.com",
  "bucket": "youlai",
  "auth": {
    "mode": "sts",
    "stsTokenUrl": "https://your-api.com/v1/getSTSToken",
    "signKey": "${STS_SIGN_KEY}",
    "contextB": "{}"
  },
  "objectKeyTemplate": "cnkfile1/M00/app/{fileName}",
  "downloadUrlTemplate": "https://file.youlai.cn/{objectKey}"
}
```

HTTP upload example:

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

## Built-in Market Channels

| Channel | Identifier | Credential Fields |
|---------|------------|-------------------|
| Huawei | `huawei` | client_id, client_secret |
| Honor | `honor` | client_id, client_secret |
| Xiaomi | `mi` | account, publicKey, privateKey |
| OPPO | `oppo` | client_id, client_secret |
| VIVO | `vivo` | access_key, access_secret |

Default multi-channel package filename identifiers: HUAWEI / HONOR / MI / OPPO / VIVO

## Agent / MCP Integration

```bash
# Machine-readable self-description
apkpub describe --json

# MCP Server mode
apkpub mcp
```

MCP-exposed tools: `apkpub_info`, `apkpub_status`, `apkpub_publish`, `apkpub_doctor`

### Cursor MCP configuration example

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

## CI Integration Example

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
      --desc "Automated CI release" \
      --yes --json --no-progress
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All succeeded |
| 2 | Argument/configuration error |
| 3 | Version check failed |
| 4 | Partial channel failure |
| 5 | All failed |

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## Security

- Config directory permissions: `~/.apkpub/` 0700, config files 0600
- `config export` strips secrets by default
- Logs and JSON output are automatically redacted
- Custom channel URLs are forced to HTTPS and blocked from internal addresses (SSRF protection)

See [SECURITY.md](SECURITY.md) for the full security policy and vulnerability reporting.

## Contributing

Issues and Pull Requests are welcome! Before getting involved, please read:

- [Contributing Guide (CONTRIBUTING.md)](CONTRIBUTING.md)
- [Code of Conduct (CODE_OF_CONDUCT.md)](CODE_OF_CONDUCT.md)
- [Changelog (CHANGELOG.md)](CHANGELOG.md)

## License

Released under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for details.
