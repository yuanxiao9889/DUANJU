# 画布生成节点选中式控制面板规范

## 目标

AI 图片/视频生成类节点统一采用“主输入节点 + 选中式悬浮控制面板”的结构，降低大画布中常驻控件、图片预览、事件监听和 DOM 数量带来的性能压力。

首批按此规范改造或对齐的节点：

- `ImageEditNode`
- `JimengNode`
- `SeedanceNode`
- `ViduNode`
- `GptBestVideoNode` / `GptBestGrokVideoNode`
- `JimengImageNode`

## 结构原则

主节点只承载核心输入体验：

- `NodeHeader`
- prompt 输入区
- prompt 高亮层和引用 hover 层
- 上游文本锁定遮罩
- loading overlay
- React Flow handles
- resize handle

选中后才挂载悬浮面板：

- 参考图片、视频、音频预览区
- 模型、尺寸、比例、时长、清晰度等参数控件
- 风格模板、相机参数、提示词优化、撤销优化
- 生成、加入队列等主操作按钮
- 普通状态提示文案

不要把控制面板放在主节点内部撑高节点。控制面板必须是绝对定位浮层，不改变 React Flow 节点实际尺寸。

## 尺寸规范

生成类大输入节点默认采用即梦视频同款尺寸：

```ts
const NODE_DEFAULT_WIDTH = 1000;
const NODE_DEFAULT_HEIGHT = 500;
const NODE_MIN_WIDTH = 980;
const NODE_MIN_HEIGHT = 420;
const NODE_MAX_WIDTH = 1480;
const NODE_MAX_HEIGHT = 1040;
const NODE_MAIN_WIDTH_RATIO = 0.6;
```

节点外层使用压缩后的主输入宽度：

```tsx
const compactResolvedWidth = Math.round(resolvedWidth * NODE_MAIN_WIDTH_RATIO);

<div style={{ width: `${compactResolvedWidth}px`, height: `${resolvedHeight}px` }} />
```

悬浮控制面板最大宽度对应原始完整宽度：

```tsx
className="absolute left-1/2 top-[calc(100%+10px)] w-max max-w-[166.6667%] -translate-x-1/2"
```

说明：`166.6667%` 是 `1 / 0.6`，用于让悬浮面板最大宽度回到原始节点宽度。

## 主节点外层

外层不要再画边框，避免 React Flow 选中态或内部输入框形成双层边框：

```tsx
<div
  className={`canvas-node-selection-pass-through group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] bg-transparent p-0 transition-all duration-150 ${
    selected ? "shadow-[0_4px_20px_rgba(59,130,246,0.16)]" : ""
  }`}
>
```

`canvas-node-selection-pass-through` 用于配合全局 CSS 屏蔽 React Flow 默认 selected 外框，只保留节点内部输入框选中样式。

## 输入区样式

输入区是主节点唯一视觉主体：

```tsx
<div
  ref={promptPanelRef}
  className={`relative min-h-0 flex-1 rounded-[var(--node-radius)] border bg-surface-dark/90 px-3 py-3 ${
    selected
      ? "border-accent shadow-[0_0_0_2px_rgba(59,130,246,0.5),0_4px_20px_rgba(59,130,246,0.2)]"
      : "border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
  }`}
>
```

textarea 内层不要再画边框或背景：

```tsx
className="canvas-textarea-wrap canvas-textarea-mirror-input ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none rounded-xl border border-transparent bg-transparent px-0.5 py-0 text-sm leading-6 text-transparent outline-none placeholder:text-text-muted/70 selection:bg-accent/30 selection:text-transparent caret-text-dark focus:border-transparent"
```

高亮层、hover 层与 textarea 使用相同的 `px-0.5 py-0`，避免文字错位。

## 悬浮控制面板

控制面板只在选中且非概览时挂载：

```tsx
{selected && !isOverviewRender ? (
  <div
    className="nodrag nowheel nopan pointer-events-auto absolute left-1/2 top-[calc(100%+10px)] z-30 w-max max-w-[166.6667%] -translate-x-1/2 rounded-[var(--node-radius)] border border-[rgba(15,23,42,0.24)] bg-surface-dark/95 p-2 shadow-[0_16px_34px_rgba(15,23,42,0.18)] dark:border-[rgba(255,255,255,0.22)] dark:shadow-[0_18px_42px_rgba(0,0,0,0.34)]"
    onClick={(event) => event.stopPropagation()}
    onMouseDown={(event) => event.stopPropagation()}
    onWheelCapture={(event) => event.stopPropagation()}
  >
    ...
  </div>
) : null}
```

面板规则：

- 必须带 `nodrag nowheel nopan`。
- 点击、按下、滚轮事件要阻止冒泡到画布。
- 不支持拖动悬浮面板移动节点。
- 不在 hover 时显示，只在节点选中时显示。
- 不改变节点实际尺寸，不影响连线锚点位置。

## 控件行规范

控件行不要使用 `flex-1` 撑满中间空白，应按内容自适应：

```tsx
<div className="flex items-center justify-start gap-2">
  <div className="ui-scrollbar nodrag nowheel nopan max-w-full shrink-0 cursor-default overflow-x-auto overflow-y-hidden">
    <div className="flex w-max items-center gap-1.5 pr-1">
      ...
    </div>
  </div>
  <div className="nodrag nowheel nopan flex shrink-0 cursor-default items-center gap-2">
    ...
  </div>
</div>
```

下拉控件 chip 去掉前置文字标题，只保留选择内容，标题放到 `title` 和 `aria-label`：

```tsx
<div
  ref={chipRef}
  className="flex h-7 min-w-[76px] shrink-0 items-center rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-field)] px-2"
  title={label}
>
```

节点控制按钮继续复用：

- `NODE_CONTROL_CHIP_CLASS`
- `NODE_CONTROL_PRIMARY_BUTTON_CLASS`
- `NODE_CONTROL_GENERATE_ICON_CLASS`

## 状态提示

未选中时不要显示普通说明文案。

保留关键反馈：

- 生成中：`NodeStatusBadge` 或轻量 header 状态
- 错误：`NodeStatusBadge` 或悬浮面板内错误文本
- 阻塞状态：必要时在 header 或悬浮面板内提示

普通提示，例如“连接上游图片后可引用”“选中后生成”等，应放在悬浮面板内部。

## 参考素材区

参考素材预览区必须在悬浮面板内按需挂载，避免未选中节点持续渲染大量图片、视频缩略图。

如果节点支持 `@` 引用选择器：

- 引用选择器仍放在 prompt 输入区内，因为它依赖光标和输入框坐标。
- 引用素材列表、预览 chip 放到悬浮面板。

## 弹窗与面板

与节点控制面板相关的二级弹窗只在节点选中且非概览时打开：

```tsx
isOpen={selected && !isOverviewRender && showDialog}
```

适用对象：

- `CameraParamsDialog`
- `ShotParamsPanel`
- 模型参数弹窗
- 队列/定时提交弹窗

## 概览模式

概览模式只渲染轻量文本和少量缩略图：

- 不挂载悬浮控制面板。
- 不挂载重参数组件。
- 不打开二级弹窗。
- 不触发重节点 chunk 或模型工具链加载。

## 验证清单

改造节点后至少验证：

- 未选中时只显示标题和输入框。
- 选中后下方悬浮面板出现，取消选中后卸载。
- 悬浮面板显示/隐藏不改变节点实际尺寸，不推动连线。
- 面板内点击、下拉、滚轮不会拖动画布。
- 低缩放概览模式不显示悬浮面板。
- 参考素材在未选中时不常驻挂载。
- 生成中、错误状态仍有轻量反馈。
- `npx tsc --noEmit` 通过。
- `git diff --check` 通过。
