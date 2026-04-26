# Photoshop 联动功能 Spec

## Why
用户需要在 Photoshop 和本软件之间快速传递图像数据，实现工作流的无缝衔接。通过 PS 插件和本软件的通信机制，用户可以快速将 PS 选区图像发送到画布，或将画布图像填充到 PS 选区。

## What Changes
- 新增本地 HTTP 服务器，监听 PS 插件的请求
- 新增图片接收提示气泡 UI，显示接收到的图片预览
- 新增图片发送到 PS 的功能，支持将画布图片填充到 PS 选区
- 提供 PS 插件开发指南和示例代码

## Impact
- Affected specs: 画布图片节点、通知系统
- Affected code:
  - `src-tauri/src/commands/` 新增 PS 通信命令
  - `src/features/canvas/` 新增图片接收/发送逻辑
  - `src/components/` 新增提示气泡组件

## ADDED Requirements

### Requirement: 本地 HTTP 服务器

系统 SHALL 在本地启动一个 HTTP 服务器，用于接收 PS 插件发送的图像数据。

#### Scenario: 启动服务器
- **WHEN** 应用启动时
- **THEN** 系统自动在指定端口（默认 9527）启动 HTTP 服务器

#### Scenario: 接收图像数据
- **WHEN** PS 插件向服务器 POST 图像数据（Base64 或二进制）
- **THEN** 系统接收数据，解析图像，触发提示气泡显示

#### Scenario: 服务器端口冲突
- **WHEN** 默认端口被占用
- **THEN** 系统自动尝试下一个可用端口，并记录实际端口

### Requirement: 图片接收提示气泡

系统 SHALL 在收到 PS 传输的图像时显示提示气泡。

#### Scenario: 显示提示气泡
- **WHEN** 收到 PS 发送的图像数据
- **THEN** 系统在界面右下角显示提示气泡，包含图片预览和"添加到画布"按钮

#### Scenario: 点击添加到画布
- **WHEN** 用户点击"添加到画布"按钮
- **THEN** 系统在画布中心创建新的图片节点，包含接收到的图像

#### Scenario: 点击关闭气泡
- **WHEN** 用户点击关闭按钮或气泡超时（30秒）
- **THEN** 系统关闭气泡，丢弃接收的图像数据

#### Scenario: 多张图片接收
- **WHEN** 连续收到多张图片
- **THEN** 系统在气泡中显示图片队列，用户可逐个或批量添加

### Requirement: 发送图片到 Photoshop

系统 SHALL 支持将画布中的图片节点发送到 Photoshop。

#### Scenario: 发送图片到 PS 选区
- **WHEN** 用户在图片节点上选择"发送到 PS"操作
- **THEN** 系统将图片数据通过 HTTP 发送到 PS 插件，PS 插件将其填充到当前选区

#### Scenario: PS 未连接
- **WHEN** 发送图片时 PS 插件未响应
- **THEN** 系统显示错误提示"Photoshop 未连接，请确保 PS 插件已启动"

### Requirement: Photoshop 插件接口

系统 SHALL 提供标准化的 PS 插件通信接口。

#### Scenario: 插件获取服务器端口
- **WHEN** PS 插件启动时查询本软件端口
- **THEN** 系统返回当前 HTTP 服务器端口号

#### Scenario: 插件发送选区图像
- **WHEN** 用户在 PS 中点击插件"发送到画布"按钮
- **THEN** 插件获取当前选区图像，转换为 Base64，POST 到本软件服务器

#### Scenario: 插件接收图像填充选区
- **WHEN** 本软件发送图像到 PS 插件
- **THEN** 插件接收图像数据，填充到 PS 当前选区

## MODIFIED Requirements

### Requirement: 图片节点操作菜单

扩展图片节点的右键菜单，新增"发送到 Photoshop"选项。

**修改内容**：
- 在 `ImageEditNode` 的操作菜单中新增"发送到 PS"按钮
- 点击后调用 PS 通信接口发送图片

### Requirement: 设置页面新增 PS 联动配置

在设置页面新增 Photoshop 联动相关配置项。

**修改内容**：
- 新增服务器端口配置（默认 9527）
- 新增启用/禁用 PS 联动开关
- 新增连接状态指示器

## REMOVED Requirements

无移除的需求。

---

## 技术方案概述

### 通信架构
```
┌─────────────────┐    HTTP POST     ┌─────────────────┐
│  PS Plugin      │ ───────────────> │  本软件 HTTP    │
│  (CEP/UXP)      │                  │  Server:9527    │
│                 │ <─────────────── │                 │
└─────────────────┘    HTTP POST     └─────────────────┘
```

### API 设计

**本软件服务器端点**：
- `POST /api/ps/image` - 接收 PS 发送的图像
- `GET /api/ps/status` - 返回服务器状态和端口

**PS 插件端点**：
- `POST /api/plugin/fill-selection` - 填充图像到选区

### PS 插件技术栈
- Adobe UXP (Photoshop 2022+) 或 CEP (旧版本)
- 使用 `photoshop.app.activeDocument.activeSelection` 获取选区
- 使用 Fetch API 与本软件通信
