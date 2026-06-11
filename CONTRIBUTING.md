# 贡献指南

感谢你考虑为 apkpub-cli 做出贡献！本文档说明如何参与开发。

## 行为准则

参与本项目即表示你同意遵守我们的 [行为准则](CODE_OF_CONDUCT.md)。

## 开发环境

- Node.js >= 18
- pnpm 10+（仓库已通过 `packageManager` 字段锁定版本）

```bash
# 克隆仓库
git clone https://github.com/your-org/apkpub-cli.git
cd apkpub-cli

# 安装依赖
pnpm install

# 构建
pnpm build

# 运行测试
pnpm test

# 类型检查
pnpm typecheck
```

## 项目结构

```
src/
├── bin/        CLI 入口
├── cli/        各子命令（薄层，解析参数后调用 core）
├── core/       分发编排、版本校验、结果聚合
├── channels/   渠道抽象与各市场实现（huawei/honor/mi/oppo/vivo/custom）
├── config/     配置 schema 与持久化
├── secrets/    分层密钥解析
├── signers/    RSA / HMAC / MD5 签名工具
├── mcp/        MCP server
└── utils/      HTTP、脱敏、模板、输出等工具
```

## 提交流程

1. Fork 本仓库并基于 `main` 创建特性分支：`git checkout -b feat/your-feature`
2. 完成改动，确保 `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过
3. 遵循 [提交信息规范](#提交信息规范) 提交
4. 推送分支并发起 Pull Request

## 提交信息规范

采用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `docs` | 文档变更 |
| `refactor` | 重构（无功能变化） |
| `test` | 测试相关 |
| `chore` | 构建/工具链变更 |

示例：`feat(channel): 新增应用宝渠道支持`

## 新增渠道

新增市场渠道时，请在 `src/channels/<name>/index.ts` 实现 `Channel` 接口：

- 实现 `upload(ctx)`，以可观测的 `step` 推进多步流程
- 市场渠道实现 `getMarketState`；自定义/无审核渠道可省略
- 通过 `ApkpubError` 抛出带 `code`/`retryable` 的结构化错误
- 在 `src/channels/registry.ts` 注册渠道并补充凭证元信息
- 使用 `nock` 编写 HTTP 契约测试

## 代码规范

- 全部使用 TypeScript（ESM），开启严格模式
- 注释使用中文，UTF-8 编码，仅说明代码功能
- 不在渲染/纯函数中执行副作用
- 敏感字段必须经 `redaction` 脱敏，禁止硬编码密钥

## 报告问题

请通过 [Issues](https://github.com/your-org/apkpub-cli/issues) 提交缺陷或功能建议，并使用对应模板。涉及安全漏洞请参阅 [SECURITY.md](SECURITY.md)。

## 许可

提交贡献即表示你同意：你的贡献将依据本项目的 [Apache License 2.0](LICENSE) 授权发布。
