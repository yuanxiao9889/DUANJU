# 项目管理页面删除确认与多选删除功能实现计划

## 需求概述

1. **删除确认机制**：删除项目时弹出确认对话框，防止误删
2. **多选删除**：支持批量选择多个项目进行删除

## 当前实现分析

- 删除操作位于 `ProjectManager.tsx` 第 55-58 行，直接调用 `deleteProject(id)` 无确认
- 已有 `RenameDialog` 组件可作为确认对话框的样式参考
- `projectStore.ts` 中有 `deleteProject` 方法，但无批量删除方法

## 实现步骤

### 1. 新增 i18n 翻译 Key

**文件**: `src/i18n/locales/zh.json` 和 `src/i18n/locales/en.json`

新增以下 key：
- `project.deleteConfirmTitle`: 删除确认 / Delete Confirmation
- `project.deleteConfirmMessage`: 确定要删除项目 "{{name}}" 吗？此操作不可撤销。 / Are you sure you want to delete project "{{name}}"? This action cannot be undone.
- `project.deleteSelectedConfirmMessage`: 确定要删除选中的 {{count}} 个项目吗？此操作不可撤销。 / Are you sure you want to delete {{count}} selected projects? This action cannot be undone.
- `project.selectMode`: 选择模式 / Select Mode
- `project.selectAll`: 全选 / Select All
- `project.deselectAll`: 取消全选 / Deselect All
- `project.deleteSelected`: 删除选中 / Delete Selected
- `project.selectedCount`: 已选择 {{count}} 个项目 / {{count}} projects selected
- `project.exitSelectMode`: 退出选择 / Exit Select Mode

### 2. 创建删除确认对话框组件

**文件**: `src/features/project/DeleteConfirmDialog.tsx`

参考 `RenameDialog.tsx` 的样式和结构，创建确认对话框：
- Props: `isOpen`, `projectNames` (string[]), `onClose`, `onConfirm`
- 显示要删除的项目名称列表
- 单项目和多项目两种展示形式
- 警告文案提示不可撤销

### 3. 在 projectStore 中添加批量删除方法

**文件**: `src/stores/projectStore.ts`

新增 `deleteProjects` 方法：
- 接收项目 ID 数组
- 批量更新 state
- 调用持久化删除（复用现有的 `persistProjectDelete` 逻辑）

### 4. 修改 ProjectManager 组件

**文件**: `src/features/project/ProjectManager.tsx`

#### 4.1 新增状态
```typescript
const [isSelectMode, setIsSelectMode] = useState(false);
const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
```

#### 4.2 新增处理函数
- `handleEnterSelectMode`: 进入选择模式
- `handleExitSelectMode`: 退出选择模式并清空选择
- `handleToggleSelect`: 切换单个项目选中状态
- `handleSelectAll`: 全选/取消全选
- `handleDeleteSelected`: 批量删除选中项目
- `handleSingleDeleteClick`: 单项目删除（带确认）

#### 4.3 UI 变更
- 顶部工具栏新增"选择模式"按钮（与"新建项目"按钮并列）
- 选择模式下显示：全选/取消全选、删除选中、退出选择按钮
- 项目卡片左上角添加复选框（选择模式下显示）
- 底部显示已选数量提示
- 删除按钮点击后弹出确认对话框

### 5. 样式细节

- 复选框样式与现有 UI 风格一致（使用 Tailwind CSS）
- 选择模式下卡片 hover 效果调整（不显示操作按钮，突出选中状态）
- 选中卡片添加边框高亮效果
- 确认对话框按钮：取消（灰色）、删除（红色警示色）

## 文件变更清单

| 文件 | 操作 |
|------|------|
| `src/i18n/locales/zh.json` | 新增翻译 key |
| `src/i18n/locales/en.json` | 新增翻译 key |
| `src/features/project/DeleteConfirmDialog.tsx` | 新建组件 |
| `src/stores/projectStore.ts` | 新增 `deleteProjects` 方法 |
| `src/features/project/ProjectManager.tsx` | 重构，添加多选和确认逻辑 |

## 交互流程

### 单项目删除流程
1. 用户点击项目卡片上的删除按钮
2. 弹出确认对话框，显示项目名称
3. 用户确认后执行删除

### 多选删除流程
1. 用户点击"选择模式"按钮进入选择模式
2. 点击项目卡片或复选框选中多个项目
3. 点击"删除选中"按钮
4. 弹出确认对话框，显示选中数量
5. 用户确认后批量删除
6. 删除完成后自动退出选择模式

## 注意事项

- 选择模式下点击卡片不打开项目，只切换选中状态
- 退出选择模式时清空选中状态
- 删除确认对话框支持 ESC 关闭
- 批量删除时逐个调用 `persistProjectDelete`，复用现有重试机制
