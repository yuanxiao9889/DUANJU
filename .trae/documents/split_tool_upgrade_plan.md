# 切割工具升级计划

## 目标

为切割工具增加以下功能：
1. **单独拖动分割线位置** - 支持单独调整每条横线或竖线的位置，实现不等分切割
2. **预览放大功能** - 在预览区域添加放大/缩小功能，支持精细调整

## 当前实现分析

### 关键文件
- **编辑器**: `src/features/canvas/ui/tool-editors/SplitStoryboardToolEditor.tsx`
- **工具插件**: `src/features/canvas/tools/builtInTools.ts`
- **处理器**: `src/features/canvas/application/toolProcessor.ts`
- **后端切割**: `src-tauri/src/commands/image.rs`

### 当前数据结构
```typescript
// 工具选项
{
  rows: 3,           // 行数
  cols: 3,           // 列数
  lineThicknessPercent: 0.5,  // 分割线粗细百分比
}

// 当前布局计算（等分）
function splitSizes(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, i) => 
    base + (i < remainder ? 1 : 0)
  );
}
```

### 当前限制
1. **等分切割** - 所有单元格大小相同，无法单独调整分割线位置
2. **无放大预览** - 预览区域固定大小，无法放大查看细节

## 实现步骤

### 步骤 1: 扩展数据结构支持不等分切割

**文件**: `src/features/canvas/tools/builtInTools.ts`

**修改内容**:
```typescript
// 新增工具选项
interface SplitToolOptions {
  rows: number;
  cols: number;
  lineThicknessPercent: number;
  // 新增：每列宽度比例（百分比数组，和为100）
  colRatios?: number[];
  // 新增：每行高度比例（百分比数组，和为100）
  rowRatios?: number[];
}
```

### 步骤 2: 修改布局计算支持不等分

**文件**: `src/features/canvas/ui/tool-editors/SplitStoryboardToolEditor.tsx`

**修改 `computeSplitLayout` 函数**:
```typescript
function computeSplitLayout(
  imageWidth: number,
  imageHeight: number,
  rows: number,
  cols: number,
  lineThickness: number,
  colRatios?: number[],  // 新增
  rowRatios?: number[]   // 新增
): SplitLayout | null {
  // 使用自定义比例或默认等分
  const colWidths = colRatios 
    ? colRatios.map(r => Math.floor(usableWidth * r / 100))
    : splitSizes(usableWidth, cols);
  const rowHeights = rowRatios
    ? rowRatios.map(r => Math.floor(usableHeight * r / 100))
    : splitSizes(usableHeight, rows);
  // ...
}
```

### 步骤 3: 实现分割线拖动功能

**文件**: `src/features/canvas/ui/tool-editors/SplitStoryboardToolEditor.tsx`

**新增状态**:
```typescript
// 拖动状态
const [draggingLine, setDraggingLine] = useState<{
  type: 'horizontal' | 'vertical';
  index: number;  // 第几条线（0-indexed）
} | null>(null);

// 自定义比例
const [colRatios, setColRatios] = useState<number[]>([]);
const [rowRatios, setRowRatios] = useState<number[]>([]);
```

**新增拖动逻辑**:
```typescript
// 分割线拖动处理
const handleLineDragStart = (type: 'horizontal' | 'vertical', index: number) => {
  setDraggingLine({ type, index });
};

const handleLineDrag = (deltaX: number, deltaY: number) => {
  if (!draggingLine) return;
  
  if (draggingLine.type === 'vertical') {
    // 调整列宽比例
    const newRatios = [...colRatios];
    const deltaPercent = (deltaX / previewWidth) * 100;
    // 更新相邻两列的比例...
    setColRatios(newRatios);
  } else {
    // 调整行高比例
    const newRatios = [...rowRatios];
    const deltaPercent = (deltaY / previewHeight) * 100;
    // 更新相邻两行的比例...
    setRowRatios(newRatios);
  }
};

const handleLineDragEnd = () => {
  setDraggingLine(null);
};
```

**UI 修改**:
```tsx
{/* 可拖动的分割线 */}
{layout.lineRects.map((rect, index) => {
  const isVertical = rect.width < rect.height;  // 判断方向
  return (
    <div
      key={index}
      className={`absolute cursor-${isVertical ? 'ew-resize' : 'ns-resize'} 
        hover:bg-yellow-400/50 transition-colors`}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      onMouseDown={(e) => handleLineDragStart(
        isVertical ? 'vertical' : 'horizontal',
        isVertical ? verticalLineIndex : horizontalLineIndex
      )}
    />
  );
})}
```

### 步骤 4: 添加预览放大功能

**文件**: `src/features/canvas/ui/tool-editors/SplitStoryboardToolEditor.tsx`

**新增状态和控件**:
```typescript
// 缩放状态
const [zoom, setZoom] = useState(1);
const [pan, setPan] = useState({ x: 0, y: 0 });
const [isPanning, setIsPanning] = useState(false);

// 缩放范围
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
```

**缩放控件 UI**:
```tsx
<div className="flex items-center gap-2 mb-2">
  <button onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - 0.25))}>
    <ZoomOut className="w-4 h-4" />
  </button>
  <span className="text-sm">{Math.round(zoom * 100)}%</span>
  <button onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + 0.25))}>
    <ZoomIn className="w-4 h-4" />
  </button>
  <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
    重置
  </button>
</div>
```

**预览容器修改**:
```tsx
<div 
  className="relative overflow-hidden"
  style={{ width: previewWidth, height: previewHeight }}
  onWheel={handleWheel}  // 滚轮缩放
>
  <div
    className="absolute origin-top-left"
    style={{
      transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
    }}
  >
    <img src={displaySourceImageUrl} ... />
    {/* 分割线覆盖层 */}
  </div>
</div>
```

**滚轮缩放处理**:
```typescript
const handleWheel = (e: React.WheelEvent) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  const newZoom = clamp(zoom + delta, MIN_ZOOM, MAX_ZOOM);
  
  // 以鼠标位置为中心缩放
  const rect = containerRef.current?.getBoundingClientRect();
  if (rect) {
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const scale = newZoom / zoom;
    setPan({
      x: mouseX - (mouseX - pan.x) * scale,
      y: mouseY - (mouseY - pan.y) * scale,
    });
  }
  
  setZoom(newZoom);
};
```

### 步骤 5: 修改切割执行逻辑支持不等分

**文件**: `src/features/canvas/application/toolProcessor.ts`

**修改 `splitStoryboard` 方法**:
```typescript
private async splitStoryboard(
  sourceImage: string,
  rows: number,
  cols: number,
  lineThicknessPercent: number,
  lineThicknessPxFallback: number,
  frameNotes?: string[],
  colRatios?: number[],  // 新增
  rowRatios?: number[]   // 新增
): Promise<ToolProcessorResult> {
  // 使用自定义比例计算每格尺寸
  const columnWidths = colRatios 
    ? colRatios.map(r => Math.floor(usableWidth * r / 100))
    : this.splitIntoSegments(usableWidth, cols);
  const rowHeights = rowRatios
    ? rowRatios.map(r => Math.floor(usableHeight * r / 100))
    : this.splitIntoSegments(usableHeight, rows);
  // ...
}
```

### 步骤 6: 修改后端切割支持不等分

**文件**: `src-tauri/src/commands/image.rs`

**修改 `split_image_source` 命令**:
```rust
pub async fn split_image_source(
    source: String,
    rows: u32,
    cols: u32,
    line_thickness: u32,
    col_ratios: Option<Vec<f64>>,  // 新增
    row_ratios: Option<Vec<f64>>,  // 新增
) -> Result<Vec<String>, String> {
    // 使用自定义比例或等分
    let col_widths = match col_ratios {
        Some(ratios) => ratios.iter().map(|r| (usable_width as f64 * r / 100.0) as u32).collect(),
        None => split_equal(usable_width, cols),
    };
    // ...
}
```

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `builtInTools.ts` | 修改 | 扩展工具选项类型 |
| `SplitStoryboardToolEditor.tsx` | 修改 | 添加分割线拖动、预览放大功能 |
| `toolProcessor.ts` | 修改 | 支持不等分切割 |
| `image.ts` | 修改 | 更新 Tauri 命令参数 |
| `image.rs` | 修改 | 后端支持不等分切割 |

## UI 设计

### 分割线拖动交互
```
┌─────────────┬─────────────┐
│             │             │
│     30%     │ ← 拖动 →    │
│             │             │
├─────────────┼─────────────┤
│             │             │
│     20%     │    50%      │
│             │             │
└─────────────┴─────────────┘
```

### 缩放控件
```
[−] 100% [+] [重置]  |  鼠标滚轮：缩放  |  拖动空白：平移
```

## 验收标准

1. ✅ 可以单独拖动每条横线调整行高比例
2. ✅ 可以单独拖动每条竖线调整列宽比例
3. ✅ 拖动时显示当前比例数值
4. ✅ 预览区域支持滚轮缩放（0.5x - 4x）
5. ✅ 缩放时以鼠标位置为中心
6. ✅ 支持平移查看不同区域
7. ✅ 切割结果按照自定义比例正确分割
8. ✅ 提供"重置为等分"按钮
