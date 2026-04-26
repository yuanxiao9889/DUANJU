# 软件发送图片到 PS 功能修复计划

## 问题分析

### 当前流程
1. 软件调用 `sendImageToPhotoshop(imagePath)` → 后端 `send_image_to_photoshop` 命令
2. 后端读取图片，转 base64，通过 `send_command_to_ps` 发送命令
3. PS 插件通过 poll 机制获取命令，调用 `handleCommand`
4. `handleCommand` 处理 `sendImage` 类型，调用 `fillSelectionWithImage`
5. `fillSelectionWithImage` 将图片放置到记录的选区位置

### 已确认正常的部分
- PS 插件发送图片到软件 ✓
- 后端 `send_image_to_photoshop` 命令正确读取图片并转 base64 ✓
- PS 插件的 `handleCommand` 正确路由到 `fillSelectionWithImage` ✓

### 可能的问题点
1. **poll 机制可能没有正确获取命令** - 需要验证
2. **`fillSelectionWithImage` 函数可能有问题** - `placeEvent` 或文件操作可能失败
3. **选区记录可能没有正确保存** - `lastSelectionBounds` 可能为空

## 解决方案

### 步骤 1：增强日志和错误处理
在 PS 插件中添加更详细的日志：
- poll 获取到命令时记录
- `handleCommand` 处理时记录
- `fillSelectionWithImage` 每个步骤记录

### 步骤 2：简化 `fillSelectionWithImage` 实现
参考 sd-ppp_PS 插件的方式，使用更可靠的方法：
1. 将 base64 写入临时文件
2. 使用 `app.open()` 打开文件
3. 使用 `layer.duplicate()` 复制到目标文档
4. 调整位置和大小
5. 关闭临时文档

### 步骤 3：确保选区记录正确
- 在发送选区图片时记录选区边界
- 添加验证确保 `lastSelectionBounds` 存在

## 文件修改清单

1. `ps-plugin/index.js`
   - 增强 `fillSelectionWithImage` 函数
   - 使用 `app.open()` + `duplicate()` 方式导入图片
   - 添加详细日志

2. `src-tauri/src/commands/ps_server.rs`
   - 检查 `send_command_to_ps` 是否正确发送命令
   - 添加更多日志
