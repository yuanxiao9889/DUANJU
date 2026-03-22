# Storyboard Copilot - Photoshop UXP 插件

用于在 Adobe Photoshop 和 Storyboard Copilot 应用之间同步图像的 UXP 插件。

## 功能

- 发送 Photoshop 选区图像到 Storyboard Copilot 画布
- 从 Storyboard Copilot 画布接收图像并作为新图层插入到 Photoshop 当前文档
- 实时显示服务器连接状态
- 自动检测当前选区信息

## 安装方式

### 方式一：直接放入 Plug-ins 目录（推荐）

**Photoshop 2024+ 支持直接从 Plug-ins 目录加载 UXP 插件！**

1. 将整个 `ps-plugin` 文件夹复制到 Photoshop 的 Plug-ins 目录：
   - **Windows**: `C:\Program Files\Adobe\Adobe Photoshop 2026\Plug-ins\StoryboardCopilot\`
   - **macOS**: `/Applications/Adobe Photoshop 2026/Plug-ins/StoryboardCopilot/`

2. 重启 Photoshop

3. 在 Photoshop 中打开 "窗口" > "扩展" > "Storyboard Copilot"

### 方式二：开发模式

1. 安装 [Adobe UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/devtool/)
2. 打开 UXP Developer Tool
3. 点击 "Add Plugin" 按钮
4. 选择本目录下的 `manifest.json` 文件
5. 点击 "Load" 按钮加载插件
6. 在 Photoshop 中打开 "窗口" > "扩展" > "Storyboard Copilot"

### 方式三：打包安装

使用 UXP Developer Tool 的 "Package" 功能打包为 `.ccx` 文件，然后：
- 双击 `.ccx` 文件安装
- 或复制到 `C:\Program Files (x86)\Common Files\Adobe\UXP\PluginsStorage\PHSP\Internal\`

## 使用方法

### 1. 确保 Storyboard Copilot 应用已启动

本插件需要与 Storyboard Copilot 应用配合使用。请确保：
- Storyboard Copilot 应用已启动
- PS 联动功能已启用（设置 > Photoshop 联动）
- HTTP 服务器正在运行（默认端口 9527）

### 2. 发送选区到画布

1. 在 Photoshop 中使用选区工具选择图像区域
2. 打开插件面板（窗口 > 扩展 > Storyboard Copilot）
3. 点击 "发送选区到画布" 按钮
4. 在 Storyboard Copilot 应用中会弹出提示气泡
5. 点击 "添加到画布" 将图片添加到画布中

### 3. 从画布接收图像

1. 在 Storyboard Copilot 画布中选择图片节点
2. 点击节点工具栏中的 "发送到 PS" 按钮
3. 图像会作为新图层插入到 Photoshop 当前文档，并优先对齐到当前选区位置与尺寸

## 配置

### 服务器端口

默认端口为 9527。如果需要修改：

1. 在 Storyboard Copilot 设置中修改 PS 联动端口
2. 在插件面板中修改端口配置
3. 点击 "测试连接" 确认连接成功

### 防火墙设置

如果连接失败，请检查：
- Windows 防火墙是否允许 Storyboard Copilot 应用
- 端口 9527 是否被其他程序占用

## 故障排除

### 连接失败

1. 确认 Storyboard Copilot 应用已启动
2. 确认 PS 联动功能已启用
3. 检查端口是否正确
4. 检查防火墙设置

### 发送图像失败

1. 优先确认 Photoshop 中有选区（无选区时会回退到左上角）
2. 确认选区中有图像内容
3. 检查插件面板中的错误提示

### 接收图像失败

1. 确认 Photoshop 中有选区
2. 确认 Storyboard Copilot 中选择了图片节点
3. 检查网络连接

## 技术规格

- **插件类型**: Adobe UXP Panel
- **支持版本**: Photoshop 2024 (v24.0) 及以上
- **通信协议**: HTTP REST API
- **默认端口**: 9527 (服务器) / 9528 (插件)

## 文件结构

```
ps-plugin/
├── manifest.json    # UXP 插件配置
├── index.html       # 插件 UI
├── index.js         # 插件逻辑
├── styles.css       # 样式
├── icons/           # 插件图标
│   ├── icon-dark.png
│   └── icon-light.png
└── README.md        # 本文档
```

## 开发

### 调试

使用 UXP Developer Tool 的调试功能：
1. 加载插件后点击 "Debug" 按钮
2. 在 Chrome DevTools 中查看控制台输出

### 修改插件

1. 修改 `index.js` 或 `index.html` 文件
2. 在 UXP Developer Tool 中点击 "Reload" 重新加载插件
3. 测试修改效果

## 许可证

本插件为 Storyboard Copilot 项目的一部分。
