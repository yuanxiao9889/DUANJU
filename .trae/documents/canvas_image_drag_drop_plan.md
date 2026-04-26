# 画布图片拖放功能实现计划

## 目标

实现将图片直接拖放到画布中，自动创建上传图片节点的功能。

## 当前状态

- **节点级拖放**：UploadNode.tsx 已实现节点内的图片拖放处理
- **画布级拖放**：Canvas.tsx 目前没有画布级别的文件拖放处理
- **图片处理**：imageData.ts 中有 `prepareNodeImageFromFile` 函数处理图片文件

## 实现步骤

### 步骤 1: 在 Canvas.tsx 中添加拖放状态

**文件**: `src/features/canvas/Canvas.tsx`

**修改内容**:
```typescript
const [isDragOver, setIsDragOver] = useState(false);
```

### 步骤 2: 添加拖放事件处理函数

**文件**: `src/features/canvas/Canvas.tsx`

**新增函数**:
```typescript
const handleDragOver = useCallback((event: React.DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  // 检查是否是图片文件
  if (event.dataTransfer.types.includes('Files') || 
      event.dataTransfer.types.includes('text/uri-list')) {
    setIsDragOver(true);
  }
}, []);

const handleDragLeave = useCallback((event: React.DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  // 检查是否真的离开了画布
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX;
  const y = event.clientY;
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    setIsDragOver(false);
  }
}, []);

const handleDrop = useCallback(async (event: React.DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  setIsDragOver(false);

  // 1. 尝试获取文件
  let file: File | null = null;
  
  // 直接拖放的文件
  if (event.dataTransfer.files?.[0]) {
    file = event.dataTransfer.files[0];
  }
  // 从文件系统拖放的项
  else {
    const item = Array.from(event.dataTransfer.items || []).find(
      (candidate) => candidate.kind === 'file' && candidate.type.startsWith('image/')
    );
    file = item?.getAsFile() ?? null;
  }

  if (!file || !file.type.startsWith('image/')) {
    return;
  }

  // 2. 计算放置位置
  const { left, top } = event.currentTarget.getBoundingClientRect();
  const position = reactFlowInstance.screenToFlowPosition({
    x: event.clientX,
    y: event.clientY,
  });

  // 3. 处理图片并创建节点
  const imageData = await prepareNodeImageFromFile(file);
  addNode(CANVAS_NODE_TYPES.upload, position, imageData);
}, [reactFlowInstance, addNode]);
```

### 步骤 3: 绑定事件到 ReactFlow 组件

**文件**: `src/features/canvas/Canvas.tsx`

**修改内容**:
```tsx
<ReactFlow
  // ... 现有属性
  onDragOver={handleDragOver}
  onDragLeave={handleDragLeave}
  onDrop={handleDrop}
>
```

### 步骤 4: 添加拖放视觉反馈

**文件**: `src/features/canvas/Canvas.tsx`

**新增内容**:
在画布中添加一个覆盖层，当拖放进行时显示提示：

```tsx
{isDragOver && (
  <div className="absolute inset-0 z-50 pointer-events-none">
    <div className="absolute inset-0 bg-amber-500/10 border-2 border-dashed border-amber-500/50 rounded-lg m-4 flex items-center justify-center">
      <div className="bg-surface-dark/90 px-6 py-4 rounded-xl border border-amber-500/30 shadow-lg">
        <div className="flex items-center gap-3 text-amber-400">
          <Upload className="w-6 h-6" />
          <span className="text-lg font-medium">释放图片以上传</span>
        </div>
      </div>
    </div>
  </div>
)}
```

### 步骤 5: 导入必要的依赖

**文件**: `src/features/canvas/Canvas.tsx`

**新增导入**:
```typescript
import { prepareNodeImageFromFile } from '../application/imageData';
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes';
import { Upload } from 'lucide-react';
```

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `Canvas.tsx` | 修改 | 添加拖放事件处理和视觉反馈 |

## 功能特性

1. **支持多种拖放方式**：
   - 从文件系统直接拖放图片文件
   - 从浏览器拖放图片（如果支持）
   - 从其他应用拖放图片

2. **视觉反馈**：
   - 拖放时显示半透明覆盖层
   - 显示"释放图片以上传"提示
   - 边框高亮提示拖放区域

3. **位置计算**：
   - 使用 `screenToFlowPosition` 精确计算放置位置
   - 节点创建在鼠标释放的位置

## 验收标准

1. 可以从文件管理器拖放图片到画布
2. 拖放时显示视觉反馈
3. 释放后在上传位置创建上传图片节点
4. 支持常见图片格式（jpg, png, gif, webp 等）
