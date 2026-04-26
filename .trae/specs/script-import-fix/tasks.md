# Tasks

- [x] Task 1: 修复剧本导出功能
  - [x] SubTask 1.1: 检查 ScriptBiblePanel.tsx 中导出按钮的事件绑定
  - [x] SubTask 1.2: 确保 exportScript 函数正确调用
  - [x] SubTask 1.3: 测试各格式导出（TXT、DOCX、JSON、Markdown）

- [x] Task 2: 增强文档解析器
  - [x] SubTask 2.1: 添加 Markdown 格式支持
  - [x] SubTask 2.2: 优化场景识别正则表达式
  - [x] SubTask 2.3: 添加导入文件类型过滤

- [x] Task 3: 增强剧本分析器
  - [x] SubTask 3.1: 添加世界观提取功能到分析结果
  - [x] SubTask 3.2: 添加道具提取功能
  - [x] SubTask 3.3: 优化 LLM 提示词模板
  - [x] SubTask 3.4: 添加世界观节点创建函数

- [x] Task 4: 实现导入 UI 和流程
  - [x] SubTask 4.1: 在 ScriptBiblePanel 添加导入按钮
  - [x] SubTask 4.2: 实现文件选择和上传
  - [x] SubTask 4.3: 添加导入进度显示
  - [x] SubTask 4.4: 实现导入完成后的节点创建

- [x] Task 5: 创建资产节点
  - [x] SubTask 5.1: 创建人物节点
  - [x] SubTask 5.2: 创建场景节点
  - [x] SubTask 5.3: 创建道具节点
  - [x] SubTask 5.4: 创建世界观节点

# Task Dependencies

- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 3]
- [Task 5] depends on [Task 4]
