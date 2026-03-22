# 剧本导出功能修复计划

## 问题描述

剧本导出功能存在两个主要问题：
1. **分支检测不到**：导出时无法正确检测分支结构
2. **文件保存位置不明确**：用户无法选择保存路径，文件直接保存到默认下载目录

## 问题分析

### 问题一：分支检测逻辑缺陷

**文件**: `src/features/canvas/application/scriptExporter.ts`

**当前实现问题**:
1. 仅检查 `isBranchPoint` 标记，忽略了完整的分支元数据
2. 未分析边的连接关系（`_edges` 参数被忽略）
3. 未使用章节节点已有的分支信息：
   - `branchType`: 'main' | 'branch' | 'supplement'
   - `parentId`: 父节点 ID
   - `branchIndex`: 分支索引
   - `depth`: 深度层级
   - `isMergePoint`: 是否为合并点

### 问题二：文件保存无法选择路径

**当前实现**:
- 使用 `file-saver` 库的 `saveAs()` 方法
- 文件直接保存到浏览器默认下载目录
- 用户无法选择保存位置

**项目已有资源**:
- 已集成 `tauri-plugin-dialog`（支持文件对话框）
- 已有图片保存命令 `save_image_source_to_path`

## 实现步骤

### 步骤 1: 修复分支检测逻辑

**文件**: `src/features/canvas/application/scriptExporter.ts`

1. 重写 `detectBranches` 函数：
   - 使用 `branchType` 字段区分主分支和分支
   - 分析边的连接关系追踪分支路径
   - 使用 `parentId` 和 `depth` 构建分支树
   - 支持 `isMergePoint` 和 `mergedFromBranches`

2. 新的分支检测算法：
   ```typescript
   function detectBranches(chapters: ScriptChapterData[], edges: Edge[]): BranchInfo[] {
     // 1. 从边构建节点连接图
     // 2. 识别分支点（有多个出边的节点）
     // 3. 追踪每条分支路径
     // 4. 处理合并点
   }
   ```

### 步骤 2: 添加 Tauri 文本保存命令

**文件**: `src-tauri/src/commands/mod.rs` 或新建 `src-tauri/src/commands/export.rs`

1. 添加保存文本文件到指定路径的命令：
   ```rust
   #[tauri::command]
   pub async fn save_text_to_path(
       path: String,
       content: String,
       app: AppHandle,
   ) -> Result<(), String> {
       // 使用 tauri-plugin-fs 或 std::fs 写入文件
   }
   ```

2. 在 `lib.rs` 中注册新命令

### 步骤 3: 添加前端文件保存对话框

**文件**: `src/features/canvas/application/scriptExporter.ts`

1. 使用 `tauri-plugin-dialog` 的 `save` 对话框：
   ```typescript
   import { save } from '@tauri-apps/plugin-dialog';
   import { writeFile } from '@tauri-apps/plugin-fs';
   
   async function exportWithDialog(content: Blob, defaultName: string): Promise<boolean> {
     const path = await save({
       defaultPath: defaultName,
       filters: [
         { name: 'Word 文档', extensions: ['docx'] },
         { name: '文本文件', extensions: ['txt'] },
         { name: 'Markdown', extensions: ['md'] },
       ],
     });
     
     if (path) {
       // 写入文件
       return true;
     }
     return false;
   }
   ```

2. 修改各导出函数使用新的保存方式

### 步骤 4: 更新导出入口函数

**文件**: `src/features/canvas/application/scriptExporter.ts`

修改 `exportScript` 函数：
1. 先调用文件保存对话框让用户选择路径
2. 根据选择的格式生成内容
3. 使用 Tauri 命令保存到用户选择的路径
4. 显示保存成功/失败提示

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/features/canvas/application/scriptExporter.ts` | 修改 | 重写分支检测逻辑，添加文件对话框 |
| `src-tauri/src/commands/export.rs` | 新建 | 添加文本文件保存命令 |
| `src-tauri/src/commands/mod.rs` | 修改 | 导出新模块 |
| `src-tauri/src/lib.rs` | 修改 | 注册新命令 |

## 详细实现

### 分支检测算法改进

```typescript
interface BranchPath {
  id: string;
  startPointId: string;
  endPointId?: string;
  nodeIds: string[];
  label: string;
}

function detectBranches(
  chapters: ScriptChapterData[], 
  edges: Edge[]
): BranchPath[] {
  // 构建邻接表
  const adjacency = new Map<string, string[]>();
  const nodeIdSet = new Set(chapters.map(c => c.id));
  
  for (const edge of edges) {
    if (nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target)) {
      const targets = adjacency.get(edge.source) ?? [];
      targets.push(edge.target);
      adjacency.set(edge.source, targets);
    }
  }
  
  // 找到分支点（出度 > 1）
  const branches: BranchPath[] = [];
  const branchPoints = chapters.filter(c => {
    const targets = adjacency.get(c.id) ?? [];
    return targets.length > 1 || c.branchType === 'branch';
  });
  
  // 从每个分支点追踪路径
  for (const bp of branchPoints) {
    const targets = adjacency.get(bp.id) ?? [];
    for (let i = 0; i < targets.length; i++) {
      const path = tracePath(targets[i], adjacency, nodeIdSet);
      branches.push({
        id: `${bp.id}-${i}`,
        startPointId: bp.id,
        endPointId: path[path.length - 1],
        nodeIds: path,
        label: `分支 ${i + 1}`,
      });
    }
  }
  
  return branches;
}

function tracePath(
  startId: string, 
  adjacency: Map<string, string[]>,
  validNodes: Set<string>
): string[] {
  const path: string[] = [startId];
  let current = startId;
  
  while (true) {
    const targets = adjacency.get(current) ?? [];
    if (targets.length !== 1) break; // 终止于分支点或终点
    
    const next = targets[0];
    if (!validNodes.has(next) || path.includes(next)) break;
    
    path.push(next);
    current = next;
  }
  
  return path;
}
```

### 文件保存对话框集成

```typescript
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeBinaryFile } from '@tauri-apps/plugin-fs';

async function exportAsDocx(
  chapters: ScriptChapterData[],
  branches: BranchPath[],
  selectedBranches: string[],
  defaultTitle: string
): Promise<boolean> {
  const path = await save({
    defaultPath: `${defaultTitle}.docx`,
    filters: [{ name: 'Word 文档', extensions: ['docx'] }],
  });
  
  if (!path) return false;
  
  const doc = createDocxDocument(chapters, branches, selectedBranches);
  const blob = await Packer.toBlob(doc);
  const buffer = await blob.arrayBuffer();
  
  await writeBinaryFile(path, new Uint8Array(buffer));
  return true;
}
```
