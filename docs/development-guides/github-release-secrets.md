# GitHub 发布 Secrets 配置说明

本文用于配置当前仓库的 GitHub Actions 发布环境，尤其是 macOS 安装包的签名与公证。

当前发布工作流位置：

- [`.github/workflows/build.yml`](/E:/Storyboard-Copilot/.github/workflows/build.yml)

当前行为：

- 推送 `v*` tag 后会自动触发发布
- Windows 会构建 `NSIS` 安装包
- macOS 会构建 `universal-apple-darwin` 的 `DMG`
- macOS 如果没有配齐签名/公证 Secrets，会直接失败，不再发布“能安装但打不开”的包

## 1. 需要配置的 GitHub Secrets

仓库路径：

- GitHub 仓库
- `Settings`
- `Secrets and variables`
- `Actions`
- `New repository secret`

需要新增以下 6 个 Secrets：

| Secret 名称 | 用途 | 内容格式 |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | Developer ID Application 证书内容 | `.p12` 文件的 Base64 字符串 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设置的密码 | 明文字符串 |
| `APPLE_SIGNING_IDENTITY` | macOS 签名身份 | 例如 `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Apple 开发者账号 | Apple ID 邮箱 |
| `APPLE_PASSWORD` | 公证用 app-specific password | Apple 账号生成的专用密码 |
| `APPLE_TEAM_ID` | Apple Team ID | 10 位左右的团队 ID |

说明：

- Windows 打包目前不依赖额外私密信息，默认用 `GITHUB_TOKEN` 即可上传 Release
- macOS 这 6 个值缺任何一个，工作流都会主动失败

## 2. macOS 证书准备

前提：

- 你有 Apple Developer Program 账号
- 账号里可以创建 `Developer ID Application` 证书

### 2.1 创建 Developer ID Application 证书

在苹果开发者后台创建：

- 证书类型选择 `Developer ID Application`

完成后把证书安装到 macOS 的“钥匙串访问”中。

### 2.2 导出为 `.p12`

在“钥匙串访问”里：

1. 找到对应的 `Developer ID Application` 证书
2. 右键导出
3. 保存为 `.p12`
4. 设置一个导出密码

这个导出密码就是：

- `APPLE_CERTIFICATE_PASSWORD`

### 2.3 转成 Base64

macOS 终端：

```bash
base64 -i DeveloperID.p12 | pbcopy
```

Windows PowerShell：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("DeveloperID.p12"))
```

复制后的整段内容填到：

- `APPLE_CERTIFICATE`

## 3. 各 Secret 的获取方式

### 3.1 `APPLE_SIGNING_IDENTITY`

在 macOS 终端执行：

```bash
security find-identity -v -p codesigning
```

从输出里找到类似：

```text
Developer ID Application: Your Name (TEAMID)
```

把整段填入：

- `APPLE_SIGNING_IDENTITY`

### 3.2 `APPLE_ID`

就是你的 Apple 开发者账号邮箱。

### 3.3 `APPLE_PASSWORD`

这个不是 Apple 账号登录密码，而是专用密码。

获取方式：

1. 打开 [appleid.apple.com](https://appleid.apple.com/)
2. 登录账号
3. 进入“登录与安全”
4. 创建 `App-Specific Password`

把生成的密码填入：

- `APPLE_PASSWORD`

### 3.4 `APPLE_TEAM_ID`

获取方式：

- Apple Developer 后台 Membership 页面
- 或 App Store Connect 团队信息页面

填入团队 ID，例如：

```text
ABCDE12345
```

## 4. 建议的发布检查顺序

发布前建议确认：

1. `package.json` / `src-tauri/tauri.conf.json` 版本已经同步
2. GitHub Secrets 已全部配置
3. mac 证书没有过期
4. `APPLE_SIGNING_IDENTITY` 与导出的 `.p12` 证书一致
5. Apple 专用密码仍可用

## 5. 触发方式

可通过两种方式触发：

### 5.1 推送 tag

例如：

```bash
git tag -a v0.2.3 -m "release v0.2.3"
git push origin v0.2.3
```

### 5.2 手动触发 workflow

在 GitHub：

- `Actions`
- `Build Storyboard-Copilot`
- `Run workflow`

需要填写：

- `release_tag`
- 可选 `release_notes`

## 6. 常见问题

### 6.1 macOS 工作流直接失败

大概率原因：

- 6 个 Secrets 没配齐
- 证书 Base64 内容复制不完整
- `.p12` 导出密码错误

### 6.2 mac 安装后提示“已损坏”或“无法打开”

大概率原因：

- 没签名
- 没公证
- 使用了错误的签名身份

当前工作流已经改成：

- 如果缺少签名/公证信息，直接不发布 mac 包

### 6.3 Windows 包正常，mac 包没有产出

这通常表示：

- Windows 流程正常
- macOS 的签名/公证环境没有配置好

先看 GitHub Actions 的 `Validate macOS signing and notarization secrets` 这一步。

## 7. 当前限制说明

当前仓库已经支持：

- macOS 安装包的正确构建入口
- 强制要求签名与公证 Secrets

但需要注意：

- 即梦相关 CLI/runtime 目前仍然是明显偏 Windows 的实现
- 所以“mac 包可安装并可正常打开”与“mac 上即梦功能完整可用”是两件事

如果后续要让 mac 上的即梦流程也完整可用，还需要单独补一轮 mac runtime 适配。
