# Tasks

## 阶段一：本地 HTTP 服务器

- [x] Task 1: 在 Tauri 端创建 HTTP 服务器模块
  - [x] SubTask 1.1: 添加 actix-web 或 warp 依赖到 Cargo.toml
  - [x] SubTask 1.2: 创建 `src-tauri/src/commands/ps_server.rs` 模块
  - [x] SubTask 1.3: 实现 HTTP 服务器启动/停止命令
  - [x] SubTask 1.4: 实现 `/api/ps/image` POST 端点接收图像
  - [x] SubTask 1.5: 实现 `/api/ps/status` GET 端点返回状态
  - [x] SubTask 1.6: 实现端口自动查找（默认 9527，冲突时递增）

- [x] Task 2: 前端 PS 服务器状态管理
  - [x] SubTask 2.1: 创建 `src/stores/psIntegrationStore.ts` 状态管理
  - [x] SubTask 2.2: 创建 `src/commands/psIntegration.ts` 命令接口
  - [x] SubTask 2.3: 实现服务器状态查询和启动/停止控制

## 阶段二：图片接收提示气泡

- [x] Task 3: 创建提示气泡组件
  - [x] SubTask 3.1: 创建 `src/components/PsImageToast.tsx` 组件
  - [x] SubTask 3.2: 实现图片预览显示
  - [x] SubTask 3.3: 实现"添加到画布"按钮
  - [x] SubTask 3.4: 实现关闭/超时逻辑
  - [x] SubTask 3.5: 支持多图片队列显示

- [x] Task 4: 图片接收后创建节点
  - [x] SubTask 4.1: 在 `canvasStore` 中添加接收图片的 action
  - [x] SubTask 4.2: 实现 Base64 图片保存到本地
  - [x] SubTask 4.3: 在画布中心创建图片节点

## 阶段三：发送图片到 Photoshop

- [x] Task 5: 实现发送图片到 PS 功能
  - [x] SubTask 5.1: 在 Tauri 端实现 HTTP 客户端发送图片到 PS 插件
  - [x] SubTask 5.2: 创建 `sendImageToPhotoshop` 命令
  - [x] SubTask 5.3: 处理 PS 未连接的错误情况

- [x] Task 6: 图片节点添加发送功能
  - [x] SubTask 6.1: 在 `ImageEditNode` 操作菜单添加"发送到 PS"按钮
  - [x] SubTask 6.2: 实现点击发送逻辑
  - [x] SubTask 6.3: 显示发送状态反馈

## 阶段四：设置页面配置

- [x] Task 7: 设置页面添加 PS 联动配置
  - [x] SubTask 7.1: 在 `settingsStore` 添加 PS 联动相关设置项
  - [x] SubTask 7.2: 在 `SettingsDialog.tsx` 添加 PS 联动配置 UI
  - [x] SubTask 7.3: 添加连接状态指示器
  - [x] SubTask 7.4: 添加 i18n 翻译

## 阶段五：PS 插件示例

- [x] Task 8: 创建 PS 插件示例代码
  - [x] SubTask 8.1: 创建 `ps-plugin/` 目录结构
  - [x] SubTask 8.2: 编写 manifest.json 配置
  - [x] SubTask 8.3: 实现获取选区图像功能
  - [x] SubTask 8.4: 实现发送图像到本软件功能
  - [x] SubTask 8.5: 实现接收图像并填充选区功能
  - [x] SubTask 8.6: 编写插件使用说明文档

# Task Dependencies

- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 3]
- [Task 5] can run in parallel with [Task 1-4]
- [Task 6] depends on [Task 5]
- [Task 7] depends on [Task 2]
- [Task 8] can run in parallel with other tasks
