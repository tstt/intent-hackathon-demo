# Contributing

感谢你的贡献！为避免后续迭代造成破坏，请遵循以下流程：

Branching
- `main`：始终保持可运行、通过 CI 的最新稳定开发树。
- `release/*`：用于发布快照（例如 `release/v1.0.0`）。创建发布分支以保存稳定基线。
- 功能开发请使用 `feature/*` 或 `fix/*`，通过 Pull Request 合并到 `main`。

Pull Request
- 每次 PR 都应包含变更说明并关联 Issue（如有）。
- 在合并前确保本地运行 `npm run build` 或现有测试通过（若有）。
- 更新 `CHANGELOG.md`：对于用户可见的更改，请在合并前在 `CHANGELOG.md` 中添加条目。

Releases
- 在发布时：
  1. 从最新稳定 `main` 创建 `release/vX.Y.Z` 分支。
  2. 在该分支上更新 `CHANGELOG.md` 并提交。
  3. 创建带注释的标签：`git tag -a vX.Y.Z -m "vX.Y.Z"`。
  4. 推送分支与标签（`git push origin release/vX.Y.Z && git push origin vX.Y.Z`）。

Safety Tips
- 重大或破坏性更改请先在 feature 分支进行，发起 PR 并 @reviewer 进行代码审查。
- 对于影响外部接口（例如 EIP-712 类型、合约地址），请在变更前记录兼容性策略并通知维护者。