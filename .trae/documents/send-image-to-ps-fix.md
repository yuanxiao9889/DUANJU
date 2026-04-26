# 软件发送图片到 PS 功能修复计划

## 问题分析

当前软件发送图片到 PS 的流程：
1. 前端调用 `sendImageToPhotoshop(imageSource)` - 传递图片路径
2. 后端 `send_image_to_photoshop` 命令：
   - 读取图片文件内容
   - 转换为 base64
   - 通过 `send_command_to_ps` 发送命令给 PS 插件
   - 緻加 `requestId` 等待响应
3. PS 插件:
   - 通过 poll 机制获取命令
   - 调用 `fillSelectionWithImage` 处理图片
   - 返回响应

### 问题点
1. PS 插件的 `fillSelectionWithImage` 函数使用文件方式导入图片，可能存在文件 token 问题
2. 需要确保整个链路正确连接

## 解决方案

### 步骤 1：修改 PS 插件的 `fillSelectionWithImage` 函数
使用 Imaging API 替代文件方式：
- 使用 `imaging.createImageDataFromBuffer` 从 base64 创建图片数据
- 使用 `imaging.putPixels` 将图片放入当前图层或创建新图层
- 或者使用 `placeEvent` 通过 batchPlay 导入图片

### 步骤 2：确保后端正确发送命令
检查 `send_image_to_photoshop` 命令是否正确发送命令

### 步骤 3：测试完整流程
- 从软件发送图片
- PS 接收并显示图片

## 文件修改清单

1. `ps-plugin/index.js`
   - 修改 `fillSelectionWithImage` 函数
   - 使用 Imaging API 或 batchPlay placeEvent 导入图片

2. `src-tauri/src/commands/ps_server.rs`
   - 检查 `send_image_to_photoshop` 命令是否正确
