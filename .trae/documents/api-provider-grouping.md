# API 提供商分组管理功能设计

## 目标
将 API Key 分为"剧本 API"和"分镜 API"两组，添加测试连通性和启用控制功能。

## 现状分析
- 当前所有 Provider 混在一起，没有分组
- 没有测试连通性功能
- 没有启用/禁用控制

## 实现步骤

### 1. 后端 Rust - 添加测试连通性命令
**文件**: `src-tauri/src/commands/text_gen.rs`

添加新的 Tauri 命令：
```rust
#[tauri::command]
pub async fn test_provider_connection(
    provider: String,
    api_key: String,
    model: String,
) -> Result<bool, String>
```

### 2. 后端 Rust - 实现测试逻辑
为每个 Provider 添加 `test_connection` 方法，发送简单的测试请求验证 API Key 是否有效。

### 3. Settings Store - 添加启用状态
**文件**: `src/stores/settingsStore.ts`

添加状态：
```typescript
// 当前启用的 API
scriptProviderEnabled: string   // 当前启用的剧本 API provider ID
storyboardProviderEnabled: string  // 当前启用的分镜 API provider ID
```

添加设置函数：
```typescript
setScriptProviderEnabled: (providerId: string) => void
setStoryboardProviderEnabled: (providerId: string) => void
```

### 4. 前端 - 测试连通性功能
**文件**: `src/commands/textGen.ts`

添加测试函数：
```typescript
export async function testProviderConnection(
  provider: string, 
  apiKey: string, 
  model: string
): Promise<boolean>
```

### 5. 前端 - 设置界面 UI 更新
**文件**: `src/components/SettingsDialog.tsx`

1. **分组显示**
   - 剧本 API 组：ppio, grai, kie, fal, alibaba, coding
   - 分镜 API 组：ppio, grai (图像生成支持的)

2. **添加启用单选框**
   - 每个 provider 显示单选框，选择作为"剧本 API"或"分镜 API"
   - 或使用 Toggle 开关单独控制启用状态

3. **添加测试连接按钮**
   - 每个 provider 旁边添加"测试"按钮
   - 点击后调用 testProviderConnection
   - 显示成功/失败提示

### 6. 修改调用逻辑
**文件**: `src/commands/textGen.ts`, `src/features/canvas/infrastructure/tauriAiGateway.ts`

根据启用状态选择 provider：
```typescript
// 获取当前启用的 provider
const settings = useSettingsStore.getState();
const scriptProvider = settings.scriptProviderEnabled;
const storyboardProvider = settings.storyboardProviderEnabled;
```

## UI 效果示意

```
┌─────────────────────────────────────────────────────────┐
│ 剧本 API                                                 │
│ ○ 派欧云 (PPIO)                        [API Key] [测试] │
│ ○ GRSAI                            [API Key] [测试]    │
│ ● 阿里云百炼 (Alibaba)               [API Key] [测试] ✓│
│ ○ 阿里云 Coding Plan                 [API Key] [测试]   │
├─────────────────────────────────────────────────────────┤
│ 分镜 API                                                 │
│ ○ 派欧云 (PPIO)                        [API Key] [测试] │
│ ● GRSAI                            [API Key] [测试] ✓│
└─────────────────────────────────────────────────────────┘
```

## 关键文件
1. `src-tauri/src/commands/text_gen.rs` - 后端测试命令
2. `src/stores/settingsStore.ts` - 启用状态管理
3. `src/commands/textGen.ts` - 前端测试函数
4. `src/components/SettingsDialog.tsx` - 设置界面
