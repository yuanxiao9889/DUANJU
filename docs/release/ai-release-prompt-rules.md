# AI 打包发版提示词规则

这份文档用于指导 AI 在本仓库里执行“上传 GitHub 并打包发布”。

目标有两个：

1. 避免把版本号发错。
2. 避免只看到 mac 包就误以为整个发布已经完成。

## 1. 版本号规则

AI 发版前必须先判断这次改动属于 `patch`、`minor` 还是 `major`。

- `patch`
  - 仅适用于 bug 修复、兼容性修复、构建修复、文案修正、内部重构。
  - 不新增用户可感知的新功能。
- `minor`
  - 只要有新的用户可感知能力、新节点能力、新模型接入、新工作流、新交互行为变化，就必须用 `minor`。
  - 例如：
    - AI 图片/视频生成节点支持接入上游文本。
    - prompt 输入框在接入上游文本后改为遮罩锁定。
    - 新增渠道、新增模型、新增生成模式。
  - 上面这种情况应该发 `v2.4.0`，不应该发 `v2.3.10`。
- `major`
  - 破坏兼容、数据迁移、删除旧能力、需要用户调整使用方式的大版本变更。

## 2. 本仓库当前真实打包机制

AI 必须按下面这些事实理解仓库，不能想当然：

- 仅推送 `main` 分支不会自动打包。
- 只有推送 `v*` 标签才会触发 GitHub Actions 打包。
- 工作流文件是：
  - `.github/workflows/build.yml`
- 发布任务顺序是：
  1. `prepare-release`
  2. `Build macOS Release`
  3. `Build Windows Release`

这意味着：

- 先看到 mac 包是正常的，因为 Windows 任务会晚于 mac 任务开始。
- 如果 Windows 任务还没结束，就还不能说“发布完成”。
- `updater` 相关文件不是 mac 任务产出的，而是 Windows 任务产出的。

## 3. updater 的真实来源

本项目 updater 依赖下面这个地址：

- `https://github.com/yuanxiao9889/DUANJU/releases/latest/download/latest.json`

配置位置：

- `src-tauri/tauri.conf.json`

AI 必须知道：

- `latest.json` 是 Windows 发布阶段才会上传的。
- 只有 mac 包时，通常还没有 `latest.json`。
- 没有 `latest.json`，应用内更新检查通常就不会完成到最终可更新状态。
- Windows 发布还会产出 `.sig` 签名文件，供 updater 使用。

## 4. 一次完整发版成功的判定标准

AI 不要只检查 tag 推送成功，必须检查发布结果。

一次发版至少要满足下面几点，才算“真的完成”：

- GitHub 上已经推送了正确版本号的 tag。
- GitHub Actions 对应工作流已经启动。
- `Build macOS Release` 成功。
- `Build Windows Release` 成功。
- Release 页面至少出现这些关键资产：
  - macOS `.dmg`
  - Windows `oopii_<version>_x64-setup.exe`
  - Windows `oopii_<version>_x64-setup.exe.sig`
  - `latest.json`

只要 `latest.json` 还没出现，就不能告诉用户“更新推送好了”。

## 5. mac 包为什么经常先出来

这是当前工作流设计决定的，不是异常：

- mac 任务先跑并先上传 DMG。
- Windows 任务依赖 mac 任务成功后再开始。
- 所以发布中途可能只看到 mac 资产。

另外当前工作流里，如果 Apple 签名证书没配好，mac 会自动退回：

- `unsigned-test` DMG

这属于测试包，不是正式签名包。

## 6. AI 发版前必须执行的本地步骤

AI 发版前必须按顺序做这些事：

1. 确认当前版本号和最新 tag。
2. 判断本次应该发 `patch` / `minor` / `major`。
3. 先提交功能代码，不要把功能改动和 release commit 混成一团。
4. 补发布说明文件：
   - `docs/releases/vX.Y.Z.md`
5. 跑本地检查：
   - `npx tsc --noEmit`
   - `npm run build`
6. 确认工作区干净。
   - 因为 `npm run release` 要求 clean worktree。
7. 再执行发版命令：
   - `npm run release -- patch --notes-file docs/releases/vX.Y.Z.md`
   - 或
   - `npm run release -- minor --notes-file docs/releases/vX.Y.Z.md`
   - 或
   - `npm run release -- major --notes-file docs/releases/vX.Y.Z.md`
8. 发版后继续检查 GitHub Actions 状态，直到 Windows 任务结束。
9. 最后再把 Release 链接、Actions 链接、最终资产情况反馈给用户。

## 7. 如果版本号发错了

如果 AI 已经把版本号发成了错误的级别：

- 不要默认删 tag、改历史、强推。
- 优先告诉用户当前错误点。
- 默认策略是基于当前状态继续补发一个正确的新版本。

例如：

- 错发成 `v2.3.10`
- 但语义上应为 `v2.4.0`

默认应该和用户确认后补发 `v2.4.0`，而不是直接改写远端历史。

## 8. 给 AI 的标准提示词

下面这段可以直接复制给 AI：

```md
请按仓库 `docs/release/ai-release-prompt-rules.md` 执行发版。

本次目标：

1. 先判断版本号应该是 `patch` / `minor` / `major`，不要默认发 patch。
2. 先完成本地校验：
   - `npx tsc --noEmit`
   - `npm run build`
3. 功能代码先单独提交。
4. 补 `docs/releases/vX.Y.Z.md` 发布说明。
5. 再执行正式发版命令：
   - `npm run release -- <patch|minor|major> --notes-file docs/releases/vX.Y.Z.md`
6. 发版后不要只看 tag，要继续检查 GitHub Actions。
7. 必须确认 Windows 发布完成，并确认 Release 里已经有：
   - `.dmg`
   - `oopii_<version>_x64-setup.exe`
   - `oopii_<version>_x64-setup.exe.sig`
   - `latest.json`
8. 只有 `latest.json` 出现后，才能说 updater 已推送完成。
9. 最终回复里必须说明：
   - 实际发了哪个版本
   - Actions 链接
   - Release 链接
   - 当前资产是否完整

如果这次改动包含新功能、新节点能力、新交互行为变化，必须优先按 `minor` 发版。
```

## 9. 本次事故的结论示例

给未来 AI 的参考判断：

- “AI 图片/视频生成节点接入上游文本，并增加遮罩锁定交互”
- 这是新增用户可感知能力
- 正确语义版本应为：
  - `minor`
  - 即 `v2.4.0`
- 不应按 `patch` 发成 `v2.3.10`
