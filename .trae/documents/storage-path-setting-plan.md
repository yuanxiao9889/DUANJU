# 存储路径设置功能计划

## 功能概述
在设置中新增项目文件存储路径配置，允许用户自定义项目数据库和图片的存储位置。当用户更改存储路径时，自动将现有项目数据迁移到新路径。

## 当前存储结构
- **SQLite 数据库**: `{app_data_dir}/projects.db`
- **图片目录**: `{app_data_dir}/images/`
- **调试目录**: `{app_data_dir}/debug/`

`app_data_dir` 由操作系统决定：
- Windows: `C:\Users\{username}\AppData\Roaming\{app-identifier}\`
- macOS: `~/Library/Application Support/{app-identifier}/`
- Linux: `~/.config/{app-identifier}/`

## 实现步骤

### 1. 前端 - settingsStore 添加存储路径设置项

**文件**: `src/stores/settingsStore.ts`

添加设置项：
```typescript
// 项目存储路径（空字符串表示使用默认路径）
projectStoragePath: string; // 默认: ''
```

### 2. 前端 - 设置页面添加存储路径配置 UI

**文件**: `src/components/SettingsDialog.tsx`

在「通用」分类下添加：
- 当前存储路径显示（只读）
- 「更改路径」按钮
- 路径选择对话框（使用 Tauri dialog）
- 迁移进度提示

### 3. Tauri 端 - 添加存储路径相关命令

**文件**: `src-tauri/src/commands/storage.rs`（新建）

命令列表：
- `get_current_storage_path()` - 获取当前存储路径
- `get_default_storage_path()` - 获取默认存储路径
- `set_storage_path(new_path: string)` - 设置新的存储路径
- `migrate_storage(from_path: string, to_path: string)` - 迁移存储数据

### 4. Tauri 端 - 修改现有存储逻辑

**文件**: `src-tauri/src/commands/project_state.rs`

修改 `resolve_db_path()` 函数：
- 优先读取配置的存储路径
- 如果配置为空，使用默认路径

**文件**: `src-tauri/src/commands/image.rs`

修改 `resolve_images_dir()` 函数：
- 使用与数据库相同的存储路径

### 5. 存储路径配置文件

**文件**: `{app_data_dir}/storage_config.json`

存储用户配置的路径，格式：
```json
{
  "customPath": "/path/to/custom/storage"
}
```

### 6. 迁移逻辑

迁移步骤：
1. 验证目标路径可写
2. 关闭当前数据库连接
3. 复制 `projects.db` 到新路径
4. 复制 `images/` 目录到新路径
5. 更新配置文件
6. 重新打开数据库连接
7. 验证迁移成功后删除旧文件（可选）

### 7. 错误处理

- 目标路径不存在时自动创建
- 目标路径无写入权限时提示错误
- 迁移过程中断时回滚
- 磁盘空间不足时提示

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/stores/settingsStore.ts` | 修改 | 添加 `projectStoragePath` 设置项 |
| `src/components/SettingsDialog.tsx` | 修改 | 添加存储路径配置 UI |
| `src/commands/storage.ts` | 新建 | 前端存储命令接口 |
| `src-tauri/src/commands/storage.rs` | 新建 | Tauri 存储命令实现 |
| `src-tauri/src/commands/project_state.rs` | 修改 | 使用配置的存储路径 |
| `src-tauri/src/commands/image.rs` | 修改 | 使用配置的存储路径 |
| `src-tauri/src/lib.rs` | 修改 | 注册新命令 |

## UI 设计

```
┌─────────────────────────────────────────────────────────┐
│ 通用设置                                                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 项目存储路径                                            │
│ ┌─────────────────────────────────────┐ ┌───────────┐  │
│ │ C:\Users\xxx\AppData\Roaming\...    │ │ 更改路径  │  │
│ └─────────────────────────────────────┘ └───────────┘  │
│                                                         │
│ 当前存储:                                               │
│ • 项目数据库: 12.5 MB                                   │
│ • 图片文件: 256.8 MB                                    │
│                                                         │
│ [打开存储目录]                                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

迁移对话框：
```
┌─────────────────────────────────────────────────────────┐
│ 迁移项目数据                                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 正在迁移项目数据到新位置...                              │
│                                                         │
│ ████████████░░░░░░░░ 60%                                │
│                                                         │
│ 正在复制图片文件...                                      │
│                                                         │
│ [取消]                                                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 注意事项

1. **路径验证**: 确保目标路径有效且可写
2. **数据安全**: 迁移前备份，迁移后验证
3. **跨平台**: 路径格式在不同操作系统上正确处理
4. **大文件处理**: 图片可能很大，迁移需要显示进度
5. **并发安全**: 迁移期间禁止其他数据库操作
