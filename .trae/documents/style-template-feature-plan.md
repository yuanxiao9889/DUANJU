# 风格模板功能实现计划

## 功能概述

将 AI 图片节点中的"启用联网搜索"功能替换为"风格模板"选择功能。用户可以预设风格提示词，在生成图片时快速选择应用。

**重要变更**：不预设默认模板，全部由用户自行添加。添加入口放在项目管理页面。

## 一、数据结构设计

### 1.1 风格模板数据结构

```typescript
// src/stores/settingsStore.ts

interface StyleTemplate {
  id: string;           // 唯一标识
  name: string;         // 模板名称（显示用）
  prompt: string;       // 风格提示词内容
  createdAt: number;    // 创建时间戳
}

// settingsStore 新增字段
styleTemplates: StyleTemplate[];
```

### 1.2 初始状态

- 默认为空数组（无预设模板）
- 用户通过项目管理页面按钮添加

## 二、UI 设计

### 2.1 项目管理页面 - 风格模板入口

**位置**: 项目管理页面顶部按钮区域

**交互**:
1. 在"新建项目"按钮旁边添加"风格模板"按钮
2. 点击后打开风格模板管理对话框
3. 对话框内支持新建/编辑/删除模板

**样式**:
```
┌─────────────────────────────────────────────────────────────┐
│ 短剧助手 v1.0                                               │
├─────────────────────────────────────────────────────────────┤
│ 我的短剧项目          [排序▼] [多选] [风格模板] [+ 新建项目] │
│                                                             │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│ │ 项目卡片    │ │ 项目卡片    │ │ 项目卡片    │            │
│ └─────────────┘ └─────────────┘ └─────────────┘            │
└─────────────────────────────────────────────────────────────┘

点击"风格模板"后弹出对话框:
┌────────────────────────────────────────────┐
│ 风格模板                              [×]  │
├────────────────────────────────────────────┤
│ [+ 新建模板]                               │
├────────────────────────────────────────────┤
│ ┌────────────────────────────────────────┐ │
│ │ 水彩风格                       [编辑]  │ │
│ │ 水彩画风格，柔和的色彩晕染...          │ │
│ └────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────┐ │
│ │ 油画风格                       [编辑]  │ │
│ │ 油画风格，厚重的笔触，丰富的色彩...    │ │
│ └────────────────────────────────────────┘ │
│                                            │
│ 暂无风格模板，点击上方按钮创建             │
└────────────────────────────────────────────┘

新建/编辑弹窗:
┌────────────────────────────────────┐
│ 新建风格模板                       │
├────────────────────────────────────┤
│ 模板名称                           │
│ ┌────────────────────────────────┐ │
│ │                                │ │
│ └────────────────────────────────┘ │
│                                    │
│ 提示词内容                         │
│ ┌────────────────────────────────┐ │
│ │                                │ │
│ │                                │ │
│ │                                │ │
│ └────────────────────────────────┘ │
│                                    │
│        [取消]  [保存]              │
└────────────────────────────────────┘
```

### 2.2 AI 图片节点 - 风格模板选择器

**位置**: 替换原"启用联网搜索"的位置（ModelParamsControls 面板中）

**交互**:
1. 点击风格模板按钮，展开下拉菜单
2. 显示预设模板列表 + "无"选项
3. 选择后自动将提示词追加到 prompt 文本框末尾
4. 当前选中的模板高亮显示

**样式**:
```
┌─────────────────────────────────┐
│ [风格模板 ▼]  [1K]  [16:9]     │  <- 节点控制栏
└─────────────────────────────────┘

点击后展开:
┌─────────────────────────────────┐
│  无                             │
│  ─────────────────────────────  │
│  水彩风格                       │
│  油画风格                       │
│  动漫风格                       │
│  ...                            │
│  ─────────────────────────────  │
│  + 管理风格模板...              │  <- 点击打开管理对话框
└─────────────────────────────────┘

无模板时:
┌─────────────────────────────────┐
│  无                             │
│  ─────────────────────────────  │
│  + 管理风格模板...              │
└─────────────────────────────────┘
```

### 2.3 设置页面 - 移除风格模板

风格模板管理入口已移至项目管理页面，设置页面不再需要单独的分类。

## 三、实现步骤

### 步骤 1: 数据层 - settingsStore 扩展

**文件**: `src/stores/settingsStore.ts`

1. 添加 `StyleTemplate` 类型定义
2. 添加 `styleTemplates` 状态字段（默认空数组）
3. 添加 CRUD 方法:
   - `addStyleTemplate(template: Omit<StyleTemplate, 'id' | 'createdAt'>)`
   - `updateStyleTemplate(id: string, updates: Partial<Pick<StyleTemplate, 'name' | 'prompt'>>)`
   - `deleteStyleTemplate(id: string)`
4. 更新版本号，添加迁移逻辑

### 步骤 2: 项目管理页面 - 风格模板入口

**文件**: `src/features/project/ProjectManager.tsx`

1. 在顶部按钮区域添加"风格模板"按钮
2. 创建风格模板管理对话框组件 `StyleTemplateDialog.tsx`
3. 对话框内实现:
   - 模板列表展示
   - 新建/编辑弹窗
   - 删除确认
4. 连接 settingsStore 的 CRUD 方法

### 步骤 3: 移除联网搜索功能

**文件**:
- `src/features/canvas/ui/ModelParamsControls.tsx`
- `src/features/canvas/nodes/ImageEditNode.tsx`
- `src/features/canvas/nodes/StoryboardGenNode.tsx`
- `src-tauri/src/ai/providers/fal/mod.rs`
- `src-tauri/src/ai/providers/kie/mod.rs`

1. 移除 `showWebSearchToggle`、`webSearchEnabled`、`onWebSearchToggle` props
2. 移除相关判断逻辑
3. 移除后端 `enable_web_search` 参数处理

### 步骤 4: 添加风格模板选择器

**文件**:
- `src/features/canvas/ui/ModelParamsControls.tsx`
- `src/features/canvas/nodes/ImageEditNode.tsx`
- `src/features/canvas/nodes/StoryboardGenNode.tsx`

1. 添加 `selectedStyleTemplate`、`onStyleTemplateSelect` props
2. 实现风格模板下拉选择 UI
3. 选择后触发回调，将提示词追加到 prompt
4. 添加"管理风格模板"快捷入口

### 步骤 5: i18n 国际化

**文件**:
- `src/i18n/locales/zh.json`
- `src/i18n/locales/en.json`

添加文案:
```json
{
  "settings": {
    "styleTemplates": "风格模板",
    "styleTemplatesDesc": "管理预设的风格提示词模板",
    "addStyleTemplate": "新建模板",
    "editStyleTemplate": "编辑模板",
    "deleteStyleTemplate": "删除模板",
    "templateName": "模板名称",
    "templatePrompt": "提示词内容",
    "manageStyleTemplates": "管理风格模板..."
  },
  "canvas": {
    "styleTemplate": "风格模板",
    "noStyleTemplate": "无",
    "applyStyleTemplate": "应用风格"
  }
}
```

### 步骤 6: 测试验证

1. 类型检查: `npx tsc --noEmit`
2. Rust 检查: `cd src-tauri && cargo check`
3. 功能测试:
   - 新建/编辑/删除模板
   - 节点中选择模板并验证提示词填充
   - 设置页面持久化验证

## 四、文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/stores/settingsStore.ts` | 修改 | 添加风格模板状态和方法 |
| `src/features/project/ProjectManager.tsx` | 修改 | 添加风格模板按钮入口 |
| `src/features/project/StyleTemplateDialog.tsx` | 新建 | 风格模板管理对话框组件 |
| `src/features/canvas/ui/ModelParamsControls.tsx` | 修改 | 移除联网搜索，添加风格选择器 |
| `src/features/canvas/nodes/ImageEditNode.tsx` | 修改 | 移除联网搜索，添加风格选择逻辑 |
| `src/features/canvas/nodes/StoryboardGenNode.tsx` | 修改 | 移除联网搜索，添加风格选择逻辑 |
| `src/i18n/locales/zh.json` | 修改 | 添加中文文案 |
| `src/i18n/locales/en.json` | 修改 | 添加英文文案 |
| `src-tauri/src/ai/providers/fal/mod.rs` | 修改 | 移除 web_search 参数 |
| `src-tauri/src/ai/providers/kie/mod.rs` | 修改 | 移除 google_search 参数 |

## 五、交互细节

### 5.1 提示词追加逻辑

选择风格模板后，提示词以以下方式追加到 prompt:

```
原始 prompt: "一个美丽的风景"
选择模板后: "一个美丽的风景，水彩画风格，柔和的色彩晕染，纸张纹理，轻盈透明"
```

- 如果 prompt 已有内容，用逗号分隔
- 如果 prompt 为空，直接使用模板提示词
- 选择"无"时不清空 prompt，只是不追加

### 5.2 模板选择状态

- 选择模板后，按钮显示当前模板名称
- 切换模板时，先移除旧模板提示词，再追加新模板
- 关闭节点后选择状态重置

### 5.3 快捷入口

风格模板下拉菜单底部添加"管理风格模板..."选项，点击后:
1. 关闭下拉菜单
2. 打开风格模板管理对话框
