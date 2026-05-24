# 样式架构说明

## 目录结构

```
styles/
├── base.qss          # 基础通用样式（真正的全局样式）
├── components.qss    # 通用组件样式（跨模式共享）
├── grid.qss          # 网格模式专用样式
├── update.qss        # 更新对话框样式
├── canvas.qss        # 画布模式专用样式
├── dialogs.qss       # 对话框样式
├── templates/        # 主题模板（variant_*.qss.template）
├── style_loader.py   # 样式加载器
└── README.md         # 本文档
```

## 模板渲染与主题 Token

### 单一真源约定（重要）

- **唯一可编辑源**：`styles/templates/variant_*.qss.template`
- **生成产物**：`styles/*.qss`（禁止手改）
- **同步命令**：`python scripts/sync_qss_from_templates.py`

> `styles/*.qss` 文件头部会标注 `AUTO-GENERATED`，如需修改样式请编辑对应 template 后重新同步。

为支持变体主题与主色统一管理，StyleLoader 支持渲染 `styles/templates/*.qss.template` 文件：

1. **加载优先级**：
   1) `styles/variants/{variant}/{file}.qss`（变体专用）
   2) `styles/templates/variant_{file}.qss.template`（模板渲染）
   3) `styles/{file}.qss`（默认样式）

2. **模板变量**（节选）：
   - `PRIMARY_COLOR` / `PRIMARY_LIGHT`
   - `GRADIENT_START` / `GRADIENT_END`
   - `GRADIENT_HOVER_START` / `GRADIENT_HOVER_END`
   - `GRADIENT_PRESSED_START` / `GRADIENT_PRESSED_END`

3. **默认值来源**：
   - `ThemeColors.DEFAULT_PRIMARY_COLOR`
   - 变体配置 `variant_config.json` 中的 `variant_theme` 可覆盖以上 token。

> 当前模板覆盖：base/components/grid/canvas/dialogs/update/splash（含 dark 版本）。

## 样式隔离策略

### 核心原则

使用 **容器级别的 ObjectName** 作为选择器前缀，确保不同模式的样式互不冲突。

### 容器标识

- **网格模式容器**: `#gridModeContainer`
- **画布模式容器**: `#canvasModeContainer`

### 样式优先级

```
style.qss (旧样式，基础) 
  ↓
base.qss (通用基础样式)
  ↓
components.qss (通用组件)
  ↓
grid.qss (网格模式专用) / canvas.qss (画布模式专用)
  ↓
dialogs.qss (对话框)
```

## 样式文件职责

### 1. base.qss - 基础通用样式
**适用范围**: 全局，所有模式共享

**包含内容**:
- 通用的 QWidget 样式
- 通用的滚动条样式
- 通用的 QLabel、QCheckBox 等基础控件
- **不包含** 模式特定的样式

**示例**:
```css
/* 通用滚动条 - 适用于所有地方 */
QScrollBar:vertical {
    background: rgba(248, 250, 252, 0.8);
    width: 12px;
}
```

### 2. components.qss - 通用组件样式
**适用范围**: 跨模式共享的组件

**包含内容**:
- Toast 通知
- 加载图标
- 模式切换按钮
- 批量处理组件（如果两个模式都用）

**示例**:
```css
/* Toast通知 - 两个模式都会用到 */
#toastNotification {
    background-color: rgba(66, 66, 66, 0.95);
    border-radius: 8px;
}
```

### 3. grid.qss - 网格模式专用样式
**适用范围**: 仅网格模式

**包含内容**:
- 网格模式的 QSpinBox 样式
- 网格模式的 QComboBox 样式
- 网格模式的卡片样式
- 网格模式的按钮样式
- 图片网格样式

**选择器规则**: 所有选择器必须以 `#gridModeContainer` 开头

**示例**:
```css
/* 网格模式的 QSpinBox - 圆角大，渐变背景 */
#gridModeContainer QSpinBox {
    border: 2px solid #e1e5e9;
    border-radius: 12px;
    background: qlineargradient(...);
}
```

### 4. canvas.qss - 画布模式专用样式
**适用范围**: 仅画布模式

**包含内容**:
- 画布模式的工具栏
- 画布模式的侧边栏
- 画布模式的图片元素
- 画布模式的控件样式

**选择器规则**: 所有选择器必须以 `#canvasModeContainer` 开头

**示例**:
```css
/* 画布模式的侧边栏 QSpinBox - 扁平风格 */
#canvasModeContainer QSpinBox#sidebarSpinBox {
    background-color: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 8px;
}
```

### 5. dialogs.qss - 对话框样式
**适用范围**: 所有对话框

**包含内容**:
- QDialog 样式
- 对话框按钮样式
- 对话框特定组件

## 样式冲突解决

### 问题场景
网格模式和画布模式都使用 `QSpinBox`，但需要不同的样式：
- 网格模式：圆角大（12px），渐变背景，2px边框
- 画布模式：圆角小（8px），纯色背景，1px边框

### 解决方案
使用容器选择器隔离：

```css
/* grid.qss */
#gridModeContainer QSpinBox {
    border: 2px solid #e1e5e9;
    border-radius: 12px;
    background: qlineargradient(x1:0,y1:0,x2:0,y2:1, stop:0 #ffffff, stop:1 #f8f9fa);
}

/* canvas.qss */
#canvasModeContainer QSpinBox#sidebarSpinBox {
    border: 1px solid #e9ecef;
    border-radius: 8px;
    background-color: #f8f9fa;
}
```

### CSS 特异性规则
```
#canvasModeContainer QSpinBox#sidebarSpinBox  (特异性: 2个ID + 1个类型)
    优先于
#canvasModeContainer QSpinBox                  (特异性: 1个ID + 1个类型)
    优先于
QSpinBox                                       (特异性: 1个类型)
```

## 最佳实践

### 1. 添加新样式时
- **全局样式** → 添加到 `base.qss`
- **跨模式组件** → 添加到 `components.qss`
- **网格模式专用** → 添加到 `grid.qss`，使用 `#gridModeContainer` 前缀
- **画布模式专用** → 添加到 `canvas.qss`，使用 `#canvasModeContainer` 前缀

### 2. 修改现有样式时
- 确认样式所属的模式
- 在对应的文件中修改
- 使用正确的容器前缀

### 3. 调试样式冲突时
- 检查选择器的特异性
- 确认容器 ObjectName 是否正确设置
- 使用浏览器开发者工具查看实际应用的样式

## 代码示例

### 设置容器 ObjectName

```python
# main_huanyu.py - 网格模式
self.grid_view = QWidget()
self.grid_view.setObjectName("gridModeContainer")  # 关键！

# canvas_mode.py - 画布模式
class CanvasModePage(QWidget):
    def _build_ui(self):
        self.setObjectName("canvasModeContainer")  # 关键！
```

### 编写隔离的样式

```css
/* grid.qss - 网格模式的按钮 */
#gridModeContainer QPushButton#generateBtn {
    background: qlineargradient(...);
    border-radius: 16px;
    font-size: 18px;
}

/* canvas.qss - 画布模式的按钮 */
#canvasModeContainer QPushButton#canvasGenerateButton {
    background: qlineargradient(...);
    border-radius: 6px;
    font-size: 14px;
}
```

## 注意事项

1. **不要在 base.qss 中使用容器前缀** - 它是真正的全局样式
2. **grid.qss 和 canvas.qss 中必须使用容器前缀** - 确保样式隔离
3. **components.qss 根据情况决定** - 如果组件在两个模式中样式不同，需要分别在 grid.qss 和 canvas.qss 中定义
4. **保持一致的命名规范** - 使用清晰的 ObjectName
5. **避免使用 !important** - 依靠选择器特异性来控制优先级

## 迁移指南

从旧的 `style.qss` 迁移到新架构：

1. **识别样式所属模式**
   - 查看样式应用的组件在哪个模式中使用
   
2. **移动到对应文件**
   - 全局 → `base.qss`
   - 网格专用 → `grid.qss` + 添加 `#gridModeContainer` 前缀
   - 画布专用 → `canvas.qss` + 添加 `#canvasModeContainer` 前缀
   
3. **测试样式**
   - 在两个模式中分别测试
   - 确认没有样式冲突

## 维护建议

- 定期检查 `style.qss` 中是否有需要迁移的样式
- 保持样式文件的注释清晰
- 遵循模块化原则，避免样式文件过大
- 使用有意义的 ObjectName

### 推荐维护流程

1. 修改 `styles/templates/variant_*.qss.template`
2. 执行 `python scripts/sync_qss_from_templates.py`
3. 验证 UI 主题切换与变体主题

### 运行时策略（开发效率 + 生产性能）

- **开发态（默认）**
  - 启动时按需自动同步 template -> qss（仅当模板比 qss 新时触发）
  - 开关：`BANANA_AUTO_SYNC_QSS`（默认 `1`）

- **生产态（默认）**
  - 运行时禁用模板渲染，直接读取 `styles/*.qss` 生成产物
  - 开关：`BANANA_USE_TEMPLATE_AT_RUNTIME`
    - 默认：`frozen` 下为 `0`，开发态为 `1`
    - 可显式设置 `0/1` 覆盖默认行为
