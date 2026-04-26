# 视频节点功能实现计划

## 需求概述

在分镜画布中新增一个视频节点类型，支持：
1. 拖入视频文件创建节点
2. 视频播放功能
3. 视频截图功能（良好的用户体验）
4. 截图直接创建为图片节点

## 实现内容

### 1. 节点类型定义

**文件**: `src/features/canvas/domain/canvasNodes.ts`

- 新增 `video: 'videoNode'` 节点类型
- 新增 `VideoNodeData` 接口定义视频节点数据结构
- 新增 `isVideoNode` 类型守卫函数

### 2. 节点注册

**文件**: `src/features/canvas/domain/nodeRegistry.ts`

- 新增 `video` 图标类型到 `MenuIconKey`
- 新增 `videoNodeDefinition` 节点定义
- 配置节点能力：`toolbar: true`, `sourceHandle: true`

### 3. 节点显示名

**文件**: `src/features/canvas/domain/nodeDisplay.ts`

- 新增视频节点默认显示名：`'视频'`

### 4. 视频处理逻辑

**文件**: `src/features/canvas/application/videoData.ts` (新建)

- `isSupportedVideoType()` - 检查视频格式支持
- `getVideoMetadata()` - 获取视频元数据（宽高、时长）
- `prepareNodeVideoFromFile()` - 处理视频文件
- `captureVideoFrame()` - 截取视频帧为图片
- `formatVideoTime()` - 格式化时间显示

### 5. 视频节点组件

**文件**: `src/features/canvas/nodes/VideoNode.tsx` (新建)

**核心功能**：
- 拖拽/点击上传视频文件
- 视频播放器（播放/暂停、进度条、时间显示）
- 截图功能（S 键快捷键 + 按钮）
- 进度条截图位置标记
- 截图闪烁反馈动画
- 截图自动创建图片节点并连线

### 6. 节点注册

**文件**: `src/features/canvas/nodes/index.ts`

- 导入并注册 `VideoNode` 组件

### 7. 菜单图标

**文件**: 
- `src/features/canvas/NodeSelectionMenu.tsx`
- `src/features/canvas/ui/BatchOperationMenu.tsx`

- 新增 `Video` 图标映射

### 8. 画布拖拽支持

**文件**: `src/features/canvas/Canvas.tsx`

- 修改 `handleDrop` 函数支持视频文件
- 拖拽视频文件自动创建视频节点

### 9. i18n 翻译

**文件**: `src/i18n/locales/zh.json` 和 `en.json`

新增翻译 key：
- `node.menu.videoNode` - 视频节点
- `node.videoNode.*` - 视频节点相关文案

## 截图交互设计

```
┌─────────────────────────────────────────────────────┐
│  视频节点标题                              [截图]   │
├─────────────────────────────────────────────────────┤
│              视频画面区域                            │
├─────────────────────────────────────────────────────┤
│  ▶ ━━━━●━━━━━━━━━━━━━━━━━━━━━━  00:12 / 02:30     │
│      ↑ 截图标记 (黄色小圆点)                        │
├─────────────────────────────────────────────────────┤
│  按 S 键快速截图                    [📷 截图]      │
└─────────────────────────────────────────────────────┘
```

**截图体验优化**：
- 快捷键 S 快速截图（节点选中时生效）
- 进度条上黄色标记显示截图位置
- 截图时画面闪烁反馈
- 截图自动创建图片节点并连线

## 文件变更清单

| 文件 | 操作 |
|------|------|
| `src/features/canvas/domain/canvasNodes.ts` | 修改 |
| `src/features/canvas/domain/nodeRegistry.ts` | 修改 |
| `src/features/canvas/domain/nodeDisplay.ts` | 修改 |
| `src/features/canvas/application/videoData.ts` | 新建 |
| `src/features/canvas/nodes/VideoNode.tsx` | 新建 |
| `src/features/canvas/nodes/index.ts` | 修改 |
| `src/features/canvas/NodeSelectionMenu.tsx` | 修改 |
| `src/features/canvas/ui/BatchOperationMenu.tsx` | 修改 |
| `src/features/canvas/Canvas.tsx` | 修改 |
| `src/i18n/locales/zh.json` | 修改 |
| `src/i18n/locales/en.json` | 修改 |

## 验证状态

- ✅ TypeScript 类型检查通过 (`npx tsc --noEmit`)
