import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { writeFileSync } from 'fs';

const doc = new Document({
  sections: [{
    properties: {},
    children: [
      // 标题
      new Paragraph({
        text: "分镜助手 (Storyboard Copilot) 使用指南",
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      }),
      
      // 副标题
      new Paragraph({
        text: "基于节点画布的 AI 分镜工作台，一站式完成图片生成、编辑与分镜流程",
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 }
      }),

      // 目录
      new Paragraph({
        text: "目录",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      new Paragraph({ text: "1. 产品简介", spacing: { after: 100 } }),
      new Paragraph({ text: "2. 安装与运行", spacing: { after: 100 } }),
      new Paragraph({ text: "3. 界面概览", spacing: { after: 100 } }),
      new Paragraph({ text: "4. 快速开始", spacing: { after: 100 } }),
      new Paragraph({ text: "5. 核心功能", spacing: { after: 100 } }),
      new Paragraph({ text: "6. 节点系统", spacing: { after: 100 } }),
      new Paragraph({ text: "7. AI 模型配置", spacing: { after: 100 } }),
      new Paragraph({ text: "8. 项目管理", spacing: { after: 100 } }),
      new Paragraph({ text: "9. 快捷键参考", spacing: { after: 100 } }),
      new Paragraph({ text: "10. 常见问题", spacing: { after: 100 } }),
      new Paragraph({ text: "", spacing: { after: 400 } }),

      // 1. 产品简介
      new Paragraph({
        text: "1. 产品简介",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "分镜助手 ", bold: true }),
          new TextRun("是一款桌面端 AI 辅助分镜制作工具，主要功能包括：")
        ],
        spacing: { after: 200 }
      }),
      new Paragraph({ text: "• 可视化节点画布：通过拖拽节点构建分镜/剧本结构", spacing: { after: 100 } }),
      new Paragraph({ text: "• AI 图像生成：集成多种 AI 图像生成提供商", spacing: { after: 100 } }),
      new Paragraph({ text: "• 一站式工作流：从构思到导出，全流程支持", spacing: { after: 100 } }),
      new Paragraph({ text: "• 双模式支持：分镜项目和剧本项目", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "技术栈：", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "• 前端：React 18 + TypeScript + Zustand + @xyflow/react + TailwindCSS", spacing: { after: 100 } }),
      new Paragraph({ text: "• 桌面容器：Tauri 2", spacing: { after: 100 } }),
      new Paragraph({ text: "• 后端：Rust", spacing: { after: 100 } }),
      new Paragraph({ text: "• 数据存储：SQLite", spacing: { after: 400 } }),

      // 2. 安装与运行
      new Paragraph({
        text: "2. 安装与运行",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "2.1 环境要求", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "• Node.js 20+", spacing: { after: 100 } }),
      new Paragraph({ text: "• npm 10+", spacing: { after: 100 } }),
      new Paragraph({ text: "• Rust stable（含 Cargo）", spacing: { after: 100 } }),
      new Paragraph({ text: "• Tauri 平台依赖", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "2.2 安装步骤", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "# 1. 克隆或下载项目", spacing: { after: 50 } }),
      new Paragraph({ text: "cd storyboard-copilot", spacing: { after: 50 } }),
      new Paragraph({ text: "# 2. 安装依赖", spacing: { after: 50 } }),
      new Paragraph({ text: "npm install", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "2.3 运行方式", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "仅前端开发模式：", spacing: { after: 50 } }),
      new Paragraph({ text: "npm run dev", spacing: { after: 100 } }),
      new Paragraph({ text: "Tauri 联调模式（推荐）：", spacing: { after: 50 } }),
      new Paragraph({ text: "npm run tauri dev", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "2.4 构建发布", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "构建桌面应用：", spacing: { after: 50 } }),
      new Paragraph({ text: "npm run tauri build", spacing: { after: 100 } }),
      new Paragraph({ text: "构建完成后，安装包位于：", spacing: { after: 50 } }),
      new Paragraph({ text: "• Windows: src-tauri/target/release/bundle/msi/ 或 src-tauri/target/release/bundle/nsis/", spacing: { after: 400 } }),

      // 3. 界面概览
      new Paragraph({
        text: "3. 界面概览",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "3.1 主界面布局", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "┌─────────────────────────────────────────────────────────────┐", spacing: { after: 50 } }),
      new Paragraph({ text: "│  顶部工具栏（项目名称、AI模型切换、设置、导出等）           │", spacing: { after: 50 } }),
      new Paragraph({ text: "├────────────┬────────────────────────────────────────────────┤", spacing: { after: 50 } }),
      new Paragraph({ text: "│            │                                                │", spacing: { after: 50 } }),
      new Paragraph({ text: "│  左侧面板  │              节点画布区域                      │", spacing: { after: 50 } }),
      new Paragraph({ text: "│  (节点库)  │                                                │", spacing: { after: 50 } }),
      new Paragraph({ text: "│            │                                                │", spacing: { after: 50 } }),
      new Paragraph({ text: "├────────────┴────────────────────────────────────────────────┤", spacing: { after: 50 } }),
      new Paragraph({ text: "│  底部面板（属性编辑 / 节点详情 / AI 对话）                │", spacing: { after: 50 } }),
      new Paragraph({ text: "└─────────────────────────────────────────────────────────────┘", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "3.2 核心区域说明", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "区域            功能", spacing: { after: 50 } }),
      new Paragraph({ text: "顶部工具栏      项目操作、AI模型选择、设置、导出等", spacing: { after: 50 } }),
      new Paragraph({ text: "左侧面板        节点库，包含各类可拖拽的节点", spacing: { after: 50 } }),
      new Paragraph({ text: "中央画布        节点编辑与连线的主工作区", spacing: { after: 50 } }),
      new Paragraph({ text: "底部面板        属性编辑、AI对话、节点详情", spacing: { after: 400 } }),

      // 4. 快速开始
      new Paragraph({
        text: "4. 快速开始",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "4.1 创建新项目", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "1. 启动应用后，点击顶部工具栏的「新建项目」", spacing: { after: 50 } }),
      new Paragraph({ text: "2. 选择项目类型：分镜项目 或 剧本项目", spacing: { after: 50 } }),
      new Paragraph({ text: "3. 输入项目名称，点击确认", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "4.2 添加节点", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "1. 从左侧面板拖拽节点到画布", spacing: { after: 50 } }),
      new Paragraph({ text: "2. 或右键画布空白区域，选择「添加节点」", spacing: { after: 50 } }),
      new Paragraph({ text: "3. 常用节点：分镜节点、剧本节点、AI生成节点", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "4.3 连接节点", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "1. 从节点锚点拖拽出线", spacing: { after: 50 } }),
      new Paragraph({ text: "2. 连接到目标节点的锚点", spacing: { after: 50 } }),
      new Paragraph({ text: "3. 支持多连线、分支连线", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "4.4 使用 AI 生成图像", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "1. 添加 AI 生成节点", spacing: { after: 50 } }),
      new Paragraph({ text: "2. 在底部面板输入提示词", spacing: { after: 50 } }),
      new Paragraph({ text: "3. 选择 AI 提供商和模型", spacing: { after: 50 } }),
      new Paragraph({ text: "4. 点击生成", spacing: { after: 400 } }),

      // 5. 核心功能
      new Paragraph({
        text: "5. 核心功能",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "5.1 节点操作", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "操作              说明", spacing: { after: 50 } }),
      new Paragraph({ text: "添加节点          拖拽或右键菜单", spacing: { after: 50 } }),
      new Paragraph({ text: "删除节点          选中后按 Delete 或右键删除", spacing: { after: 50 } }),
      new Paragraph({ text: "移动节点          拖拽节点", spacing: { after: 50 } }),
      new Paragraph({ text: "复制节点          Ctrl+C / Ctrl+V", spacing: { after: 50 } }),
      new Paragraph({ text: "粘贴节点          Ctrl+V", spacing: { after: 50 } }),
      new Paragraph({ text: "全选              Ctrl+A", spacing: { after: 50 } }),
      new Paragraph({ text: "撤销              Ctrl+Z", spacing: { after: 50 } }),
      new Paragraph({ text: "重做              Ctrl+Shift+Z", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "5.2 框选与批量操作", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "• 框选：鼠标拖拽框选多个节点", spacing: { after: 50 } }),
      new Paragraph({ text: "• 批量连线：框选多个节点后，可从合并锚点拖出分支连线", spacing: { after: 50 } }),
      new Paragraph({ text: "• 批量删除：框选后按 Delete", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "5.3 对齐辅助", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "拖动节点时，画布会显示对齐虚线辅助对齐。", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "5.4 导出功能", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "格式      说明", spacing: { after: 50 } }),
      new Paragraph({ text: "PNG/JPG   单张图片导出", spacing: { after: 50 } }),
      new Paragraph({ text: "PDF       文档导出", spacing: { after: 50 } }),
      new Paragraph({ text: "DOCX      Word 文档", spacing: { after: 50 } }),
      new Paragraph({ text: "JSON      项目数据", spacing: { after: 400 } }),

      // 6. 节点系统
      new Paragraph({
        text: "6. 节点系统",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "6.1 分镜节点", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "• 分镜节点：基础分镜单元，包含图像和描述", spacing: { after: 50 } }),
      new Paragraph({ text: "• 图像节点：纯图像内容", spacing: { after: 50 } }),
      new Paragraph({ text: "• 文本节点：纯文本描述", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "6.2 剧本节点", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "• 剧本根节点：整个剧本的根节点", spacing: { after: 50 } }),
      new Paragraph({ text: "• 章节节点：章节结构", spacing: { after: 50 } }),
      new Paragraph({ text: "• 角色节点：角色信息", spacing: { after: 50 } }),
      new Paragraph({ text: "• 场景节点：场景描述", spacing: { after: 50 } }),
      new Paragraph({ text: "• 道具节点：道具信息", spacing: { after: 50 } }),
      new Paragraph({ text: "• 情节点：情节单元", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "6.3 AI 节点", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "• AI 生成节点：调用 AI 生成图像", spacing: { after: 50 } }),
      new Paragraph({ text: "• AI 对话节点：与 AI 对话交互", spacing: { after: 400 } }),

      // 7. AI 模型配置
      new Paragraph({
        text: "7. AI 模型配置",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "7.1 支持的提供商", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "• OpenAI - GPT 系列", spacing: { after: 50 } }),
      new Paragraph({ text: "• Azure OpenAI - Azure 托管", spacing: { after: 50 } }),
      new Paragraph({ text: "• Claude - Anthropic Claude", spacing: { after: 50 } }),
      new Paragraph({ text: "• Midjourney - Midjourney", spacing: { after: 50 } }),
      new Paragraph({ text: "• Stable Diffusion - 本地/云端", spacing: { after: 50 } }),
      new Paragraph({ text: "• Fal.ai - AI 图像服务", spacing: { after: 50 } }),
      new Paragraph({ text: "• Comfly - AI 服务", spacing: { after: 50 } }),
      new Paragraph({ text: "• 阿里云 - 阿里云 AI", spacing: { after: 50 } }),
      new Paragraph({ text: "• 真真 - AI 服务", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "7.2 配置步骤", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "1. 点击顶部工具栏的「设置」", spacing: { after: 50 } }),
      new Paragraph({ text: "2. 选择「AI模型」配置", spacing: { after: 50 } }),
      new Paragraph({ text: "3. 添加或编辑提供商", spacing: { after: 50 } }),
      new Paragraph({ text: "4. 输入 API Key 和相关配置", spacing: { after: 50 } }),
      new Paragraph({ text: "5. 保存配置", spacing: { after: 200 } }),

      // 8. 项目管理
      new Paragraph({
        text: "8. 项目管理",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "8.1 项目类型", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "类型          用途", spacing: { after: 50 } }),
      new Paragraph({ text: "分镜项目      图像分镜制作", spacing: { after: 50 } }),
      new Paragraph({ text: "剧本项目      剧本/故事创作", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "8.2 自动保存", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "• 项目自动持久化到 SQLite 数据库", spacing: { after: 50 } }),
      new Paragraph({ text: "• 无需手动保存", spacing: { after: 50 } }),
      new Paragraph({ text: "• 数据位于：app_data_dir/projects.db", spacing: { after: 200 } }),

      // 9. 快捷键参考
      new Paragraph({
        text: "9. 快捷键参考",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "9.1 通用快捷键", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "快捷键        功能", spacing: { after: 50 } }),
      new Paragraph({ text: "Ctrl+N        新建项目", spacing: { after: 50 } }),
      new Paragraph({ text: "Ctrl+O        打开项目", spacing: { after: 50 } }),
      new Paragraph({ text: "Ctrl+S        手动保存", spacing: { after: 50 } }),
      new Paragraph({ text: "Ctrl+Z        撤销", spacing: { after: 50 } }),
      new Paragraph({ text: "Ctrl+Shift+Z  重做", spacing: { after: 50 } }),
      new Paragraph({ text: "Ctrl+A        全选", spacing: { after: 50 } }),
      new Paragraph({ text: "Ctrl+C        复制", spacing: { after: 50 } }),
      new Paragraph({ text: "Ctrl+V        粘贴", spacing: { after: 50 } }),
      new Paragraph({ text: "Delete        删除选中", spacing: { after: 50 } }),
      new Paragraph({ text: "Ctrl+D        复制粘贴", spacing: { after: 50 } }),
      new Paragraph({ text: "Ctrl+F        搜索", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "9.2 画布操作", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "快捷键          功能", spacing: { after: 50 } }),
      new Paragraph({ text: "空格+拖拽        平移画布", spacing: { after: 50 } }),
      new Paragraph({ text: "滚轮             缩放画布", spacing: { after: 50 } }),
      new Paragraph({ text: "Ctrl+0           重置缩放", spacing: { after: 50 } }),
      new Paragraph({ text: "Ctrl+1           适应画布", spacing: { after: 400 } }),

      // 10. 常见问题
      new Paragraph({
        text: "10. 常见问题",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "10.1 安装问题", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "Q: npm install 失败", spacing: { after: 50 } }),
      new Paragraph({ text: "A: 确保 Node.js 版本 >= 20，尝试清理缓存：npm cache clean --force", spacing: { after: 100 } }),
      new Paragraph({ text: "Q: Rust 编译错误", spacing: { after: 50 } }),
      new Paragraph({ text: "A: 确保已安装 Rust：rustup install stable，更新 Rust：rustup update", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "10.2 运行问题", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "Q: Tauri 启动失败", spacing: { after: 50 } }),
      new Paragraph({ text: "A: 检查 Tauri 平台依赖是否安装，查看控制台错误信息", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "10.3 AI 生成问题", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "Q: AI 生成失败", spacing: { after: 50 } }),
      new Paragraph({ text: "A: 检查 API Key 是否正确配置，确认网络连接正常，查看配额是否用完", spacing: { after: 400 } }),

      // 附录
      new Paragraph({
        text: "附录",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "A. 项目结构", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "src/", spacing: { after: 50 } }),
      new Paragraph({ text: "  features/canvas/          画布主流程", spacing: { after: 50 } }),
      new Paragraph({ text: "  features/project/         项目管理", spacing: { after: 50 } }),
      new Paragraph({ text: "  features/settings/        设置功能", spacing: { after: 50 } }),
      new Paragraph({ text: "  stores/                    全局状态", spacing: { after: 50 } }),
      new Paragraph({ text: "  commands/                  Tauri 命令桥接", spacing: { after: 50 } }),
      new Paragraph({ text: "  i18n/                      国际化", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "B. 数据存储", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "• SQLite 数据库位置：app_data_dir/projects.db", spacing: { after: 100 } }),
      new Paragraph({ text: "• 表结构：projects, nodes_json, edges_json, viewport_json", spacing: { after: 200 } }),

      new Paragraph({
        children: [
          new TextRun({ text: "C. 国际化", bold: true })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({ text: "支持中文和英文，可在设置中切换语言。", spacing: { after: 400 } }),

      // 页脚
      new Paragraph({
        text: "文档版本：v0.1.14  |  最后更新：2026-03-20",
        alignment: AlignmentType.CENTER,
        spacing: { before: 400 }
      }),
    ],
  }],
});

import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 输出到项目根目录
// 输出到 C 盘根目录
const outputPath = 'C:\\Storyboard_Copilot_User_Guide.docx';

Packer.toBuffer(doc).then((buffer) => {
  writeFileSync(outputPath, buffer);
  console.log('Word 文档已生成:', outputPath);
});
