# 剧本导入功能修复与增强 Spec

## Why

当前剧本导出功能存在问题，导入功能不完善。需要修复导出功能并设计基于 LLM 的智能导入机制，自动分析剧本内容并拆分为章节、世界观、人物等结构化数据。

## What Changes

- 修复剧本导出功能，确保导出按钮正确触发导出流程
- 新增基于 LLM 的剧本智能分析导入功能
- 支持从 TXT、DOCX、Markdown 等格式导入
- 自动提取章节、人物、场景、道具、世界观等元素
- 创建对应的画布节点

## Impact

- Affected specs: 剧本项目创建流程、画布节点生成
- Affected code: 
  - `src/features/canvas/application/scriptExporter.ts`
  - `src/features/canvas/application/scriptAnalyzer.ts`
  - `src/features/canvas/application/documentParser.ts`
  - `src/features/canvas/ui/ScriptBiblePanel.tsx`

## ADDED Requirements

### Requirement: 剧本导出功能修复

系统 SHALL 正确响应导出按钮点击事件，生成对应格式的导出文件。

#### Scenario: 导出为 TXT 格式
- **WHEN** 用户点击导出按钮并选择 TXT 格式
- **THEN** 系统生成包含完整剧本内容的 TXT 文件并下载

#### Scenario: 导出为 DOCX 格式
- **WHEN** 用户点击导出按钮并选择 DOCX 格式
- **THEN** 系统生成格式化的 Word 文档并下载

### Requirement: 剧本智能导入功能

系统 SHALL 提供基于 LLM 的剧本智能分析导入功能，自动识别剧本结构。

#### Scenario: 导入 TXT 文件
- **WHEN** 用户上传 TXT 格式的剧本文件
- **THEN** 系统解析文本内容，调用 LLM 分析，生成章节节点和资产节点

#### Scenario: 导入 DOCX 文件
- **WHEN** 用户上传 DOCX 格式的剧本文件
- **THEN** 系统提取文本内容，调用 LLM 分析，生成章节节点和资产节点

#### Scenario: LLM 分析提取章节
- **WHEN** 剧本内容被解析后
- **THEN** 系统调用 LLM 分析剧本，提取章节标题、摘要、情感走向、伏笔等信息

#### Scenario: LLM 分析提取人物
- **WHEN** 剧本内容被解析后
- **THEN** 系统调用 LLM 识别主要角色，提取姓名、描述、性格、外貌等信息

#### Scenario: LLM 分析提取世界观
- **WHEN** 剧本内容被解析后
- **THEN** 系统调用 LLM 识别故事背景，提取时代、科技水平、社会结构等信息

### Requirement: 导入进度反馈

系统 SHALL 在导入过程中提供清晰的进度反馈。

#### Scenario: 显示导入进度
- **WHEN** 用户上传文件后
- **THEN** 系统显示"正在解析文档..."、"正在分析剧本..."、"正在创建节点..."等进度提示

#### Scenario: 导入完成提示
- **WHEN** 导入流程完成
- **THEN** 系统显示导入结果摘要（章节数、人物数、场景数等）

## MODIFIED Requirements

### Requirement: 剧本分析器增强

增强 `scriptAnalyzer.ts` 的分析能力，支持更完整的剧本元素提取。

**修改内容**：
- 新增世界观提取功能
- 新增道具提取功能
- 新增情节埋点提取功能
- 优化提示词模板，提高分析准确性

### Requirement: 文档解析器增强

增强 `documentParser.ts` 的解析能力。

**修改内容**：
- 支持 Markdown 格式
- 支持更多剧本格式变体
- 提高场景识别准确率
