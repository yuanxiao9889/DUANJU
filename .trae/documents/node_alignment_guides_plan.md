# 节点对齐辅助线功能实现计划

## 目标

实现节点拖动时的智能对齐辅助线功能，当拖动节点靠近其他节点时，显示水平/垂直对齐辅助虚线。

## 功能描述

参考图片中的效果：
- 当拖动节点时，检测与其他节点的对齐关系
- 显示水平对齐辅助线（顶部对齐、中部对齐、底部对齐）
- 显示垂直对齐辅助线（左对齐、中对齐、右对齐）
- 辅助线为虚线样式
- 当节点靠近对齐位置时，自动吸附对齐

## 当前实现分析

### 关键文件
- **画布组件**: `src/features/canvas/Canvas.tsx`
- **画布 Store**: `src/stores/canvasStore.ts`
- **节点类型**: `src/features/canvas/domain/canvasNodes.ts`

### React Flow 对齐支持
React Flow 本身没有内置的节点对齐辅助线功能，需要自定义实现。

## 实现步骤

### 步骤 1: 创建对齐辅助线组件

**文件**: `src/features/canvas/ui/AlignmentGuides.tsx`

```typescript
interface AlignmentGuide {
  type: 'horizontal' | 'vertical';
  position: number;  // y坐标（水平线）或 x坐标（垂直线）
  style: 'top' | 'center' | 'bottom' | 'left' | 'middle' | 'right';
}

interface AlignmentGuidesProps {
  guides: AlignmentGuide[];
  containerWidth: number;
  containerHeight: number;
}

export function AlignmentGuides({ guides, containerWidth, containerHeight }: AlignmentGuidesProps) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {guides.map((guide, index) => (
        <div
          key={index}
          className="absolute border-dashed border-accent/50"
          style={{
            ...(guide.type === 'horizontal' ? {
              top: guide.position,
              left: 0,
              right: 0,
              borderTopWidth: '1px',
            } : {
              left: guide.position,
              top: 0,
              bottom: 0,
              borderLeftWidth: '1px',
            }),
          }}
        />
      ))}
    </div>
  );
}
```

### 步骤 2: 实现对齐检测逻辑

**文件**: `src/features/canvas/application/nodeAlignment.ts`

```typescript
interface NodeBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  centerX: number;
  centerY: number;
}

interface AlignmentResult {
  guide: AlignmentGuide;
  snapOffset: { x: number; y: number };
}

const SNAP_THRESHOLD = 10; // 吸附阈值（像素）

export function detectAlignments(
  draggedNode: Node,
  otherNodes: Node[],
  threshold: number = SNAP_THRESHOLD
): AlignmentResult[] {
  const draggedBounds = getNodeBounds(draggedNode);
  const alignments: AlignmentResult[] = [];

  for (const otherNode of otherNodes) {
    if (otherNode.id === draggedNode.id) continue;
    
    const otherBounds = getNodeBounds(otherNode);
    
    // 检测水平对齐（y轴方向）
    // 顶部对齐
    if (Math.abs(draggedBounds.top - otherBounds.top) < threshold) {
      alignments.push({
        guide: { type: 'horizontal', position: otherBounds.top, style: 'top' },
        snapOffset: { x: 0, y: otherBounds.top - draggedBounds.top },
      });
    }
    // 中部对齐
    if (Math.abs(draggedBounds.centerY - otherBounds.centerY) < threshold) {
      alignments.push({
        guide: { type: 'horizontal', position: otherBounds.centerY, style: 'center' },
        snapOffset: { x: 0, y: otherBounds.centerY - draggedBounds.centerY },
      });
    }
    // 底部对齐
    if (Math.abs(draggedBounds.bottom - otherBounds.bottom) < threshold) {
      alignments.push({
        guide: { type: 'horizontal', position: otherBounds.bottom, style: 'bottom' },
        snapOffset: { x: 0, y: otherBounds.bottom - draggedBounds.bottom },
      });
    }

    // 检测垂直对齐（x轴方向）
    // 左对齐
    if (Math.abs(draggedBounds.left - otherBounds.left) < threshold) {
      alignments.push({
        guide: { type: 'vertical', position: otherBounds.left, style: 'left' },
        snapOffset: { x: otherBounds.left - draggedBounds.left, y: 0 },
      });
    }
    // 中对齐
    if (Math.abs(draggedBounds.centerX - otherBounds.centerX) < threshold) {
      alignments.push({
        guide: { type: 'vertical', position: otherBounds.centerX, style: 'middle' },
        snapOffset: { x: otherBounds.centerX - draggedBounds.centerX, y: 0 },
      });
    }
    // 右对齐
    if (Math.abs(draggedBounds.right - otherBounds.right) < threshold) {
      alignments.push({
        guide: { type: 'vertical', position: otherBounds.right, style: 'right' },
        snapOffset: { x: otherBounds.right - draggedBounds.right, y: 0 },
      });
    }
  }

  return alignments;
}

function getNodeBounds(node: Node): NodeBounds {
  const width = node.width ?? 200;
  const height = node.height ?? 100;
  const x = node.position.x;
  const y = node.position.y;
  
  return {
    id: node.id,
    x,
    y,
    width,
    height,
    top: y,
    bottom: y + height,
    left: x,
    right: x + width,
    centerX: x + width / 2,
    centerY: y + height / 2,
  };
}
```

### 步骤 3: 在 Canvas 组件中集成对齐功能

**文件**: `src/features/canvas/Canvas.tsx`

**新增状态**:
```typescript
const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
const [isDraggingNode, setIsDraggingNode] = useState(false);
```

**修改节点拖动处理**:
```typescript
const handleNodeDrag = useCallback((event: ReactMouseEvent, node: Node) => {
  if (!isDraggingNode) {
    setIsDraggingNode(true);
  }

  // 检测对齐
  const otherNodes = nodes.filter(n => n.id !== node.id);
  const alignments = detectAlignments(node, otherNodes);
  
  // 更新辅助线
  setAlignmentGuides(alignments.map(a => a.guide));

  // 应用吸附（可选）
  if (alignments.length > 0 && snapToGrid) {
    const bestAlignment = alignments[0];
    // 应用吸附偏移
    const newPosition = {
      x: node.position.x + bestAlignment.snapOffset.x,
      y: node.position.y + bestAlignment.snapOffset.y,
    };
    // 更新节点位置...
  }
}, [nodes, snapToGrid]);

const handleNodeDragStop = useCallback(() => {
  setIsDraggingNode(false);
  setAlignmentGuides([]);
}, []);
```

**渲染辅助线**:
```tsx
<ReactFlow ...>
  {/* ... */}
  
  {/* 对齐辅助线 */}
  {isDraggingNode && alignmentGuides.length > 0 && (
    <AlignmentGuides 
      guides={alignmentGuides}
      containerWidth={canvasViewportSize.width}
      containerHeight={canvasViewportSize.height}
    />
  )}
</ReactFlow>
```

### 步骤 4: 添加对齐设置到 Store

**文件**: `src/stores/canvasStore.ts`

```typescript
interface CanvasState {
  // ... 现有状态
  
  // 对齐设置
  enableNodeAlignment: boolean;  // 是否启用节点对齐
  alignmentThreshold: number;    // 对齐阈值（像素）
  showAlignmentGuides: boolean;  // 是否显示对齐辅助线
  
  setEnableNodeAlignment: (enabled: boolean) => void;
  setAlignmentThreshold: (threshold: number) => void;
  setShowAlignmentGuides: (show: boolean) => void;
}
```

**默认值**:
```typescript
enableNodeAlignment: true,
alignmentThreshold: 10,
showAlignmentGuides: true,
```

### 步骤 5: 在右下角控制条添加对齐开关

**文件**: `src/features/canvas/Canvas.tsx`

在右下角控制条中添加对齐开关按钮：
```tsx
{/* 对齐辅助线开关 */}
<button
  onClick={() => setShowAlignmentGuides(!showAlignmentGuides)}
  style={{ 
    color: showAlignmentGuides ? '#3b82f6' : '#6b7280',
    padding: '6px',
    borderRadius: '4px'
  }}
  title={showAlignmentGuides ? '关闭对齐辅助线' : '开启对齐辅助线'}
>
  <AlignCenter style={{ width: '16px', height: '16px' }} />
</button>

<div style={{ width: '1px', height: '16px', backgroundColor: '#374151' }} />
```

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `nodeAlignment.ts` | 新建 | 对齐检测逻辑 |
| `AlignmentGuides.tsx` | 新建 | 对齐辅助线组件 |
| `canvasStore.ts` | 修改 | 添加对齐设置 |
| `Canvas.tsx` | 修改 | 集成对齐功能 |

## UI 设计

### 对齐辅助线样式
- 线条类型: 虚线 (border-dashed)
- 线条颜色: 主题色半透明 (border-accent/50)
- 线条宽度: 1px

### 对齐场景
```
水平对齐:
┌─────────┐
│ 节点A   │ ─────── 顶部对齐线
└─────────┘
     │
     │      ─────── 中部对齐线
     │
┌─────────┐
│ 节点B   │ ─────── 底部对齐线
└─────────┘

垂直对齐:
┌─────────┐     ┌─────────┐
│ 节点A   │ │   │ 节点B   │
└─────────┘ │   └─────────┘
            │
       左对齐  中对齐  右对齐
```

## 验收标准

1. ✅ 拖动节点时显示对齐辅助虚线
2. ✅ 支持水平对齐（顶部、中部、底部）
3. ✅ 支持垂直对齐（左、中、右）
4. ✅ 对齐线使用虚线样式
5. ✅ 对齐线使用主题色半透明
6. ✅ 可以开启/关闭对齐辅助线
7. ✅ 可以调整对齐阈值
8. ✅ 对齐时可选自动吸附
