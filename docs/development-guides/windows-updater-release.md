# Windows 应用内更新发布说明

## 目标

- Windows 版本使用 Tauri 官方 updater，通过 GitHub Release 提供 `latest.json`、安装包和签名文件。
- macOS 继续上传 DMG，但不参与 `latest.json` 生成。
- 首个带 updater 的版本，老用户仍需手动安装一次；从该版本开始，后续版本才能应用内更新。

## 本地密钥

- 私钥文件：`C:\Users\Administrator\.tauri\storyboard-copilot-updater.key`
- 公钥文件：`C:\Users\Administrator\.tauri\storyboard-copilot-updater.key.pub`
- 私钥口令文件：`C:\Users\Administrator\.tauri\storyboard-copilot-updater.password.txt`

注意：

- 私钥和口令不要提交到仓库。
- `src-tauri/tauri.conf.json` 里只写公钥。
- 后续所有 Windows 更新包必须继续复用这一把私钥，否则已安装客户端会拒绝更新。

## GitHub Secrets

在仓库 Actions Secrets 中新增：

- `TAURI_SIGNING_PRIVATE_KEY`
  直接填入私钥文件全文内容。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  填入私钥口令。

如果后续更换发布机器，也要把同一把私钥和口令安全迁移过去。

## Release 流程

1. 先准备本次更新说明，放到 `docs/releases/vx.y.z.md`。
2. 本地继续用既有命令发版：
   - `npm run release -- patch --notes-file docs/releases/vx.y.z.md`
3. GitHub Actions 会在对应 tag 上执行：
   - Windows job：构建 NSIS 安装包、生成 `.sig`、生成并上传 `latest.json`
   - macOS job：继续上传 DMG，不覆盖 `latest.json`

固定 updater 地址：

- `https://github.com/yuanxiao9889/DUANJU/releases/latest/download/latest.json`

## 发布后校验

发布完成后，至少检查以下内容：

- GitHub Release 里存在 Windows 安装包。
- 同一个 Release 里存在对应 `.sig` 文件。
- 同一个 Release 里存在 `latest.json`。
- `latest.json` 下载地址指向当前 tag 下的 Windows 安装包，而不是错误的旧资产。
- Windows 已安装的新版本能在“设置 -> 通用 -> 应用更新”里手动检查到下一版。

## 失败回滚

如果 `latest.json`、签名或资产地址配置错了：

- 先修复 Release 资产并重新跑对应 tag 的 GitHub Actions。
- 在客户端恢复前，仍可通过 GitHub Release 或夸克网盘手动下载更新。
- 不要随意更换 updater 私钥；一旦更换，旧客户端将无法验证后续更新。

## 运营提示

- 发布说明里要明确提示：
  - “首个支持应用内更新的版本需要手动安装一次。”
- 如果应用内更新失败，弹窗里仍保留：
  - GitHub Release 手动下载
  - 夸克网盘兜底下载
