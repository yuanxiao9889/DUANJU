# UI资源优化计划 - 画布、节点、连接线

## 一、现状分析

### 1.1 画布背景
- **当前状态**：简单的点状网格 (`BackgroundVariant.Dots`)
- **点大小**：1px
- **颜色**：`rgba(255,255,255,0.08)`（暗色主题下几乎不可见）
- **问题**：视觉层次感不足，背景过于单调

### 1.2 节点样式
- **边框**：`border-[rgba(15,23,42,0.22)]`，较浅
- **选中状态**：蓝色边框 + 微弱阴影 `shadow-[0_0_0_1px_rgba(59,130,246,0.32)]`
- **背景**：`bg-surface-dark/85`，半透明
- **问题**：立体感不足，选中状态不够醒目

### 1.3 连接线样式
- **默认线宽**：1.9px（选中时 2.4px）
- **颜色**：继承自 style，无默认主题色
- **处理中状态**：蓝色流动虚线动画
- **问题**：普通连接线视觉存在感弱，颜色对比度不足

### 1.4 Handle（连接点）
- **尺寸**：8px x 8px（普通节点），12px x 12px（剧本节点）
- **颜色**：主题色 `accent`、琥珀色、紫色、绿色
- **问题**：hover 状态不明显，交互反馈不足

---

## 二、优化阶段划分

### 阶段一：画布背景优化

**目标**：增强画布视觉层次感，提升专业感

**修改文件**：
- `src/index.css` - 添加画布背景样式
- `src/features/canvas/Canvas.tsx` - 调整背景配置

**具体内容**：

1. **优化点状网格**
   - 增大点尺寸至 1.5px
   - 调整颜色对比度，明暗主题分别优化
   - 添加微妙的网格渐变效果

2. **添加背景层次**
   - 添加微妙的径向渐变背景
   - 优化画布边缘淡出效果

**验证方式**：
- 启动 `npm run tauri dev`
- 检查画布背景视觉效果
- 验证明暗主题切换

---

### 阶段二：节点视觉优化

**目标**：增强节点立体感和选中状态反馈

**修改文件**：
- `src/index.css` - 节点相关样式
- `src/features/canvas/nodes/ImageNode.tsx` - 图片节点样式
- `src/features/canvas/nodes/ImageEditNode.tsx` - 编辑节点样式
- `src/features/canvas/nodes/UploadNode.tsx` - 上传节点样式

**具体内容**：

1. **优化节点容器**
   - 增强节点阴影层次（多层阴影）
   - 优化边框颜色和透明度
   - 添加微妙的背景纹理

2. **优化选中状态**
   - 增强选中边框发光效果
   - 添加选中时的微妙缩放动画
   - 优化选中阴影的颜色和扩散

3. **优化 hover 状态**
   - 添加 hover 时的边框高亮
   - 增加微妙的提升效果

**验证方式**：
- 创建各类节点
- 测试选中/取消选中
- 验证 hover 效果
- 测试节点拖拽

---

### 阶段三：连接线优化

**目标**：提升连接线视觉存在感和交互反馈

**修改文件**：
- `src/index.css` - 连接线样式
- `src/features/canvas/edges/DisconnectableEdge.tsx` - 默认连接线
- `src/features/canvas/edges/BranchEdge.tsx` - 分支连接线

**具体内容**：

1. **优化默认连接线**
   - 增加默认线宽至 2px
   - 设置默认颜色为主题色半透明
   - 优化选中状态样式

2. **优化处理中动画**
   - 调整虚线流动速度
   - 增加脉冲发光效果
   - 优化颜色渐变

3. **优化分支连接线**
   - 统一使用主题变量
   - 优化中间圆点样式
   - 添加 hover 效果

**验证方式**：
- 创建节点连接
- 测试连接线选中
- 验证处理中动画
- 测试分支连接线

---

### 阶段四：Handle（连接点）优化

**目标**：增强连接点的可见性和交互反馈

**修改文件**：
- `src/index.css` - Handle 全局样式
- `src/features/canvas/nodes/*.tsx` - 各节点 Handle 样式

**具体内容**：

1. **优化 Handle 尺寸和样式**
   - 统一 Handle 尺寸规范
   - 添加边框和阴影
   - 优化颜色对比度

2. **添加交互状态**
   - 添加 hover 放大效果
   - 添加连接时的脉冲动画
   - 优化拖拽时的视觉反馈

**验证方式**：
- 测试连接点 hover
- 验证连接操作
- 测试不同节点类型

---

## 三、详细修改内容

### 3.1 画布背景样式（index.css）

```css
/* 画布背景优化 */
.react-flow__background {
  opacity: 1;
}

/* 暗色主题下的点状背景 */
.dark .react-flow__background {
  opacity: 0.9;
}

/* 画布容器背景渐变 */
.react-flow {
  background: 
    radial-gradient(ellipse at center, transparent 0%, var(--bg) 100%),
    var(--bg);
}
```

### 3.2 节点样式优化

```css
/* 节点容器基础样式 */
.react-flow__node {
  border-radius: var(--node-radius);
  box-shadow: 
    0 2px 8px rgba(0, 0, 0, 0.12),
    0 4px 16px rgba(0, 0, 0, 0.08);
  transition: box-shadow 0.2s ease, transform 0.15s ease;
}

/* 节点选中状态 */
.react-flow__node.selected {
  box-shadow: 
    0 0 0 2px rgba(var(--accent-rgb), 0.6),
    0 4px 16px rgba(var(--accent-rgb), 0.15),
    0 8px 32px rgba(0, 0, 0, 0.2);
}

/* 节点 hover 状态 */
.react-flow__node:hover:not(.selected) {
  box-shadow: 
    0 4px 12px rgba(0, 0, 0, 0.15),
    0 8px 24px rgba(0, 0, 0, 0.1);
}
```

### 3.3 连接线样式优化

```css
/* 连接线基础样式 */
.react-flow__edge-path {
  stroke: rgba(var(--text-muted-rgb), 0.5);
  stroke-width: 2px;
  transition: stroke 0.2s ease, stroke-width 0.2s ease;
}

/* 连接线选中状态 */
.react-flow__edge.selected .react-flow__edge-path {
  stroke: rgba(var(--accent-rgb), 0.8);
  stroke-width: 2.5px;
}

/* 连接线 hover 状态 */
.react-flow__edge:hover .react-flow__edge-path {
  stroke: rgba(var(--text-muted-rgb), 0.7);
}
```

### 3.4 Handle 样式优化

```css
/* Handle 基础样式 */
.react-flow__handle {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--surface);
  background: rgba(var(--accent-rgb), 0.9);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

/* Handle hover 状态 */
.react-flow__handle:hover {
  transform: scale(1.3);
  box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.2);
}

/* 连接中的 Handle */
.react-flow__handle.connecting {
  transform: scale(1.4);
  box-shadow: 0 0 0 6px rgba(var(--accent-rgb), 0.3);
  animation: handle-pulse 1s ease-in-out infinite;
}

@keyframes handle-pulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.2); }
  50% { box-shadow: 0 0 0 8px rgba(var(--accent-rgb), 0.4); }
}
```

---

## 四、验证清单

每个阶段完成后验证：

- [ ] 画布背景视觉效果
- [ ] 节点创建/删除/拖拽
- [ ] 节点选中状态
- [ ] 节点 hover 状态
- [ ] 连接线创建/删除
- [ ] 连接线选中状态
- [ ] 连接线处理中动画
- [ ] Handle hover 状态
- [ ] 连接操作流程
- [ ] 明暗主题切换
- [ ] 中英文切换

---

## 五、执行顺序

```
阶段一（画布背景）→ 验证 → 阶段二（节点）→ 验证 → 阶段三（连接线）→ 验证 → 阶段四（Handle）→ 最终验证
```

每个阶段完成后，用户可确认效果再继续下一阶段。
