# PS 插件选区图片导出修复计划

## 问题分析

### 问题 1：图像未正确传递（空文件）
当前实现使用 `batchPlay` 的 `save` 命令保存 PNG 文件，然后读取文件转 base64。这种方式存在以下问题：
- 文件可能未正确写入磁盘
- `createSessionToken` 的使用可能不正确
- 异步操作时序问题

### 问题 2：接收到 2 个事件气泡
前端可能同时监听了多个事件源，导致重复触发。

## 解决方案

### 方案 1：使用 Imaging API（推荐）
根据 Adobe UXP 文档，应该使用 `imaging.getPixels` + `imaging.encodeImageData` API：
- 直接获取选区像素数据
- 编码为 JPEG base64
- 无需创建临时文件
- 更可靠、更高效

### 方案 2：修复文件保存方式
如果必须使用文件方式，需要：
- 确保文件写入完成后再读取
- 添加适当的延迟等待
- 使用正确的 token 格式

## 实施步骤

### 步骤 1：修改 PS 插件的 `selectionToBase64` 函数
使用 Imaging API 重写：
```javascript
const imaging = require("photoshop").imaging;

// 1. 获取选区边界
// 2. 使用 imaging.getPixels 获取像素数据
// 3. 使用 imaging.encodeImageData 编码为 base64
// 4. 返回数据
```

### 步骤 2：检查并修复前端事件监听
- 检查 `psIntegrationStore.ts` 中的事件监听
- 确保只有一个事件源
- 防止重复触发

### 步骤 3：添加调试日志
- 在关键步骤添加日志
- 便于排查问题

## 文件修改清单

1. `e:\Storyboard-Copilot\ps-plugin\index.js`
   - 重写 `selectionToBase64` 函数使用 Imaging API
   - 添加错误处理和日志

2. `e:\Storyboard-Copilot\src\stores\psIntegrationStore.ts`
   - 检查事件监听是否重复
   - 添加防抖机制

3. `e:\Storyboard-Copilot\src-tauri\src\commands\ps_server.rs`
   - 添加更多日志便于调试
