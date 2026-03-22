# 项目管理界面美化计划

## 一、现状分析

### 当前组件
1. **ProjectManager.tsx** - 主项目管理页面
2. **ProjectTypeSelector.tsx** - 项目类型选择器和创建对话框
3. **RenameDialog.tsx** - 重命名对话框

### 可优化方向

| 方向 | 当前状态 | 优化目标 |
|------|----------|----------|
| 项目卡片 | 基础边框样式 | 增强层次感、添加微妙的渐变和阴影 |
| 空状态 | 简单图标+文字 | 更美观的插画风格设计 |
| 类型选择器 | 基础卡片 | 更现代的卡片设计、增强交互反馈 |
| 对话框 | 基础样式 | 更精致的圆角、阴影、过渡动画 |
| 交互反馈 | 简单hover | 更丰富的hover效果、点击反馈 |
| 过渡动画 | 部分缺失 | 添加平滑的进入/退出动画 |

## 二、优化阶段划分

### 阶段一：项目卡片美化

**修改文件**：`src/features/project/ProjectManager.tsx`

**具体内容**：
1. 增强卡片阴影和边框效果
2. 添加项目类型图标
3. 优化hover状态效果
4. 添加卡片进入动画
5. 优化项目类型标签样式

### 阶段二：空状态优化

**修改文件**：`src/features/project/ProjectManager.tsx`

**具体内容**：
1. 更大更醒目的图标
2. 添加渐变背景效果
3. 优化文字层次
4. 添加引导按钮

### 阶段三：对话框美化

**修改文件**：
- `src/features/project/ProjectTypeSelector.tsx`
- `src/features/project/RenameDialog.tsx`

**具体内容**：
1. 增强对话框阴影
2. 优化输入框样式
3. 添加过渡动画
4. 统一按钮样式

### 阶段四：项目类型选择器优化

**修改文件**：`src/features/project/ProjectTypeSelector.tsx`

**具体内容**：
1. 更现代的卡片设计
2. 增强图标效果
3. 添加选中状态反馈
4. 优化间距和布局

## 三、详细修改内容

### 3.1 项目卡片样式

```tsx
// 优化后的卡片样式
<div
  className="
    relative overflow-hidden
    bg-surface-dark/80 backdrop-blur-sm
    border border-border-dark/50
    rounded-xl p-5
    cursor-pointer
    transition-all duration-300 ease-out
    hover:border-accent/40
    hover:shadow-[0_8px_32px_rgba(0,0,0,0.15)]
    hover:-translate-y-1
    group
  "
>
```

### 3.2 空状态样式

```tsx
// 优化后的空状态
<div className="flex flex-col items-center justify-center py-24">
  <div className="relative mb-6">
    <div className="absolute inset-0 bg-accent/10 rounded-full blur-2xl scale-150" />
    <FolderOpen className="relative w-20 h-20 text-accent/40" />
  </div>
  <p className="text-xl text-text-dark font-medium">{t('project.empty')}</p>
  <p className="text-sm text-text-muted mt-2">{t('project.emptyHint')}</p>
  <UiButton variant="primary" onClick={handleCreateProject} className="mt-6 gap-2">
    <Plus className="w-4 h-4" />
    {t('project.newProject')}
  </UiButton>
</div>
```

### 3.3 对话框样式

```tsx
// 优化后的对话框
<div className="
  relative
  bg-surface-dark/95 backdrop-blur-md
  border border-border-dark/50
  rounded-2xl
  p-8
  shadow-[0_24px_48px_rgba(0,0,0,0.25)]
  max-w-lg w-full mx-4
">
```

### 3.4 类型选择器卡片

```tsx
// 优化后的类型卡片
<button
  className="
    flex flex-col items-center gap-4 p-8
    border-2 border-border-dark/50
    rounded-2xl
    bg-bg-dark/30
    hover:border-accent/50
    hover:bg-accent/5
    hover:shadow-[0_8px_24px_rgba(59,130,246,0.15)]
    transition-all duration-300
    group
  "
>
```

## 四、验证清单

- [ ] 项目卡片视觉效果提升
- [ ] 卡片hover效果流畅
- [ ] 空状态美观大方
- [ ] 对话框样式精致
- [ ] 类型选择器交互流畅
- [ ] 过渡动画平滑
- [ ] TypeScript 类型检查通过
- [ ] 明暗主题适配正常

## 五、执行顺序

```
阶段一（卡片美化）→ 验证 → 阶段二（空状态）→ 验证 → 阶段三（对话框）→ 验证 → 阶段四（类型选择器）→ 最终验证
```
