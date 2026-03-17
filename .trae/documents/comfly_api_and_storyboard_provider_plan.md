# Comfly API 图生图端点修复与分镜 API 激活逻辑优化计划

## 问题分析

### 1. Comfly API 图生图端点错误

**根本原因**：Comfly 的 API 端点区分：
- **文生图**：`/v1/images/generations`
- **图生图**：`/v1/images/edits`

**当前代码问题**：
- Comfly Provider 只使用 `/v1/images/generations` 端点
- 当有参考图片时，应该切换到 `/v1/images/edits` 端点

**Zhenzhen 对比**：
- Zhenzhen 使用统一的 `/v1/images/generations` 端点处理文生图和图生图
- 这就是为什么 Zhenzhen 能正常工作

### 2. 分镜 API 激活逻辑

**用户需求**：
- 移除分镜 API 的激活逻辑
- 保留剧本 API 的激活逻辑
- AI 生图节点可以直接选择厂商使用

## 实现步骤

### 步骤 1: 修复 Comfly Provider 图生图端点

**文件**: `src-tauri/src/ai/providers/comfly/mod.rs`

**修改内容**:
```rust
const GENERATIONS_ENDPOINT_PATH: &str = "/v1/images/generations";
const EDITS_ENDPOINT_PATH: &str = "/v1/images/edits";

// 在 request_generation 方法中，根据是否有参考图片选择端点
let endpoint = if request.reference_images.as_ref().map_or(false, |imgs| !imgs.is_empty()) {
    format!("{}{}", self.base_url, EDITS_ENDPOINT_PATH)
} else {
    format!("{}{}", self.base_url, GENERATIONS_ENDPOINT_PATH)
};
```

### 步骤 2: 移除 settingsStore 中的 storyboardProviderEnabled

**文件**: `src/stores/settingsStore.ts`

**修改内容**:
- 移除 `storyboardProviderEnabled` 状态
- 移除 `setStoryboardProviderEnabled` 方法
- **保留** `scriptProviderEnabled` 状态和相关方法

### 步骤 3: 移除 SettingsDialog 中的分镜 Provider 激活逻辑

**文件**: `src/components/SettingsDialog.tsx`

**修改内容**:
- 移除 `storyboardProviderEnabled` 相关的状态和逻辑
- 移除分镜 Provider 的激活选择 UI
- 移除 Provider Tab 切换（script/storyboard）
- **保留**剧本 API 的激活逻辑
- 设置界面只显示剧本 API 的配置

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `comfly/mod.rs` | 修改 | 添加图生图端点 `/v1/images/edits` |
| `settingsStore.ts` | 修改 | 移除 storyboardProviderEnabled，保留 scriptProviderEnabled |
| `SettingsDialog.tsx` | 修改 | 移除分镜 Provider 激活逻辑，保留剧本 API 激活逻辑 |

## 验收标准

1. Comfly 图生图使用 `/v1/images/edits` 端点
2. Comfly 文生图继续使用 `/v1/images/generations` 端点
3. 设置中不再有分镜 API 的激活选择
4. 设置中保留剧本 API 的激活选择
5. AI 生图节点可以自由选择任意厂商（只需配置 API Key）
