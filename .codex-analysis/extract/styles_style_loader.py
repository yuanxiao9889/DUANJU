# -*- coding: utf-8 -*-
"""
样式加载器 - 动态加载和合并样式
职责：加载样式文件、合并样式、缓存管理
"""

import os
import sys
import logging
import json
import re
from typing import Dict, Optional

from ui.theme.theme_colors import ThemeColors


class StyleLoader:
    """样式加载器 - 管理和加载QSS样式文件"""

    STYLE_FILES_LIGHT = (
        'base.qss', 'components.qss', 'grid.qss', 'canvas.qss',
        'dialogs.qss', 'update.qss', 'splash.qss'
    )
    STYLE_FILES_DARK = (
        'base_dark.qss', 'components_dark.qss', 'grid_dark.qss', 'canvas_dark.qss',
        'dialogs_dark.qss', 'update_dark.qss', 'splash_dark.qss'
    )
    
    def __init__(self, theme: str = 'light', variant: str = None):
        """
        初始化样式加载器
        
        Args:
            theme: 主题名称，'light' 或 'dark'，默认为 'light'
            variant: 变体名称，如 'xiaoqiang', 'goumeigong'，默认为 None
        """
        self.theme = theme
        self.variant = variant
        self.styles_dir = self.get_styles_directory()
        self.use_template_runtime = self._resolve_template_runtime_usage()
        self.cache: Dict[str, str] = {}
        logging.debug(
            f"样式加载器初始化 - 样式目录: {self.styles_dir}, 主题: {self.theme}, "
            f"变体: {self.variant}, 运行时模板: {self.use_template_runtime}"
        )

    @staticmethod
    def _env_to_bool(value: str) -> Optional[bool]:
        """将环境变量字符串解析为布尔值。"""
        normalized = (value or "").strip().lower()
        if normalized in ("1", "true", "yes", "on"):
            return True
        if normalized in ("0", "false", "no", "off"):
            return False
        return None

    def _resolve_template_runtime_usage(self) -> bool:
        """解析运行时是否使用模板。

        规则：
        - 环境变量 BANANA_USE_TEMPLATE_AT_RUNTIME 显式配置优先
        - 未配置时：统一启用（打包与开发态走同一渲染路径）
        - frozen 态下若 templates 目录不存在则自动降级
        """
        env_value = os.environ.get('BANANA_USE_TEMPLATE_AT_RUNTIME', '')
        parsed = self._env_to_bool(env_value)
        if parsed is not None:
            return parsed
        if getattr(sys, 'frozen', False):
            templates_dir = os.path.join(self.styles_dir, 'templates')
            if not os.path.isdir(templates_dir):
                logging.warning("frozen 环境未找到 styles/templates 目录，降级为静态 QSS")
                return False
        return True

    def _get_theme_style_files(self):
        """获取当前主题对应的样式文件列表。"""
        return self.STYLE_FILES_DARK if self.theme == 'dark' else self.STYLE_FILES_LIGHT
    
    def load_all_styles(self, render_tokens: bool = True) -> str:
        """
        加载所有样式文件并合并
        
        Args:
            render_tokens: 是否渲染模板 token，False 时返回保留占位符的结构样式
        
        Returns:
            str: 合并后的样式字符串
        """
        # 使用新的模块化样式架构，不再加载旧的 style.qss
        combined_style = ""
        
        # 注释：旧的 style.qss 已废弃，所有样式已迁移到模块化文件
        # 如需回退，可以取消下面的注释
        # old_style_path = os.path.join(os.path.dirname(self.styles_dir), 'style.qss')
        # if os.path.exists(old_style_path):
        #     try:
        #         with open(old_style_path, 'r', encoding='utf-8') as f:
        #             combined_style = f.read()
        #             combined_style += "\n\n/* ===== 以下为新架构的覆盖样式 ===== */\n\n"
        #         logging.info("已加载 style.qss 作为基础样式")
        #     except Exception as e:
        #         logging.warning(f"加载 style.qss 失败: {e}")
        
        # 加载新架构的样式文件（按优先级顺序）
        # 根据主题选择文件列表
        style_files = self._get_theme_style_files()
        
        for file in style_files:
            style = self.load_style_file(file, render_tokens=render_tokens)
            if style:
                combined_style += f"\n/* ===== {file} ===== */\n"
                combined_style += style
        
        # ✅ 动态生成平台适配补丁（侵入性最小的适配方案）
        platform_patch = self._generate_platform_patch()
        if platform_patch:
            combined_style += platform_patch
            logging.debug("已应用平台样式补丁")
        
        logging.debug(f"已加载样式文件")
        return combined_style

    def build_structure_styles(self) -> str:
        """构建结构样式（移除包含 token 的颜色块）"""
        combined_style = ""
        style_files = self._get_theme_style_files()

        for file in style_files:
            style = self._load_structure_file(file)
            if style:
                combined_style += f"\n/* ===== {file} ===== */\n"
                combined_style += style

        platform_patch = self._generate_platform_patch()
        if platform_patch:
            combined_style += platform_patch
            logging.debug("已应用平台样式补丁")

        logging.debug("已构建结构样式")
        return combined_style

    def build_color_patch(self) -> str:
        """构建颜色补丁（仅包含 token 块）"""
        combined_patch = ""
        style_files = self._get_theme_style_files()

        for file in style_files:
            patch = self._load_color_patch(file)
            if patch:
                logging.debug("颜色补丁片段构建: %s len=%d", file, len(patch))
                combined_patch += f"\n/* ===== {file} (color) ===== */\n"
                combined_patch += patch

        logging.debug("已构建颜色补丁")
        return combined_patch

    @classmethod
    def build_multi_theme_styles(cls, variant: Optional[str] = None) -> str:
        """构建包含 light/dark 的合并样式，供单次 setStyleSheet 使用。"""
        combined = []
        for theme_name in ("light", "dark"):
            loader = cls(theme=theme_name, variant=variant)
            structure = loader.build_structure_styles()
            color_patch = loader.build_color_patch()
            themed_style = structure + color_patch
            themed_style = cls.prefix_theme_selectors(themed_style, theme_name)
            combined.append(f"\n/* ===== Theme {theme_name} ===== */\n")
            combined.append(themed_style)
        return "".join(combined)

    @staticmethod
    def _self_theme_selector_enabled() -> bool:
        env_value = os.environ.get("BANANA_THEME_SELF_SELECTOR", "1").strip().lower()
        return env_value not in ("0", "false", "no", "off")

    @staticmethod
    def _apply_theme_selector(selector: str, theme: str) -> str:
        selector = selector.strip()
        if not selector or selector.startswith("@"):
            return selector
        if "[theme=" in selector:
            return selector

        prefix = ""
        while selector.startswith("/*"):
            end_idx = selector.find("*/")
            if end_idx == -1:
                break
            end_idx += 2
            prefix += selector[:end_idx]
            selector = selector[end_idx:].lstrip()
        if not selector:
            return prefix

        def inject_theme_attr(target: str) -> str:
            insert_pos = len(target)
            for token in ("::", ":"):
                idx = target.find(token)
                if idx != -1:
                    insert_pos = min(insert_pos, idx)
            return f"{target[:insert_pos]}[theme=\"{theme}\"]{target[insert_pos:]}"

        ancestor_selector = f"QWidget[theme=\"{theme}\"] {selector}"
        if not StyleLoader._self_theme_selector_enabled():
            return f"{prefix}{ancestor_selector}"

        self_selector = inject_theme_attr(selector)
        themed_selector = f"{ancestor_selector}, {self_selector}"
        return f"{prefix}{themed_selector}"

    @classmethod
    def prefix_theme_selectors(cls, content: str, theme: str) -> str:
        """为 QSS 选择器添加 theme 属性前缀。"""
        result = []
        selector_buffer = []
        body_buffer = []
        depth = 0
        for ch in content:
            if ch == "{":
                depth += 1
                if depth == 1:
                    selector = "".join(selector_buffer)
                    selector_buffer = []
                    themed_selectors = []
                    for part in selector.split(","):
                        themed_selectors.append(cls._apply_theme_selector(part, theme))
                    result.append(", ".join([s for s in themed_selectors if s]))
                    result.append("{")
                else:
                    body_buffer.append(ch)
            elif ch == "}":
                if depth == 1:
                    result.append("".join(body_buffer))
                    result.append("}")
                    body_buffer = []
                else:
                    body_buffer.append(ch)
                depth = max(depth - 1, 0)
            else:
                if depth == 0:
                    selector_buffer.append(ch)
                else:
                    body_buffer.append(ch)

        if selector_buffer:
            result.append("".join(selector_buffer))
        return "".join(result)
    
    def _generate_platform_patch(self) -> str:
        """
        根据当前平台配置动态生成 QSS 补丁
        解决 macOS 下字号、间距、尺寸过大的问题
        """
        try:
            from ui.configs.ui_adapter import get_ui_value
            
            patch = "\n/* ===== Platform Dynamic Patch ===== */\n"
            
            # 1. 画布工具栏适配
            # 读取配置
            tb_height = get_ui_value('canvas_toolbar', 'height', 64)
            tb_btn_height = get_ui_value('canvas_toolbar', 'button_height', 44)
            tb_font_size = get_ui_value('canvas_toolbar', 'font_size', 15)
            tb_spacing = get_ui_value('canvas_toolbar', 'spacing', 12)
            
            # 生成 QSS
            patch += f"""
            #canvasTopToolbar {{
                min-height: {tb_height}px;
                max-height: {tb_height}px;
                spacing: {tb_spacing}px;
            }}
            #canvasTopToolbar QPushButton {{
                min-height: {tb_btn_height}px;
                max-height: {tb_btn_height}px;
                font-size: {tb_font_size}px;
                padding: 0 8px; /* 减小内边距 */
            }}
            #canvasTopToolbar QLabel {{
                font-size: {tb_font_size}px;
            }}
            """
            
            # 2. 画布侧边栏 (CanvasSidebar) 内部组件适配
            # 注：下拉框相关规则已移除（画布模式不再使用该入口）
            sb_btn_height = get_ui_value('canvas_sidebar', 'expand_btn_height', default=32)
            
            patch += f"""
            /* 侧边栏展开按钮适配 */
            QPushButton#sidebarContainer {{
                min-height: {sb_btn_height}px;
                max-height: {sb_btn_height}px;
                padding: 4px;
            }}
            """
            
            # 4. 工具栏按钮字体适配 (已移至 CanvasToolbar 组件内部)
            
            # 5. 图片工具按钮（裁切、合并等）
            # 这些通常在浮动工具栏中，可能有特定的 ObjectName 或类
            # 假设它们是 QPushButton 且在特定容器内
            tool_btn_height = get_ui_value('image_tool_buttons', 'button_height', 44)
            
            # 针对常见的工具按钮类（如果定义了的话）
            # 这里我们针对通用的 icon-button 样式进行微调
            # 如果是 macOS，全局减小 QPushButton 的 padding
            import sys
            if sys.platform == 'darwin':
                # 获取配置
                img_tool_font = get_ui_value('image_tool_buttons', 'font_size', default=13)
                img_tool_icon = get_ui_value('image_tool_buttons', 'icon_size', default=18)
                splash_title_font = get_ui_value('splash_screen', 'title_font_size', default=28)
                
                patch += f"""
                QPushButton {{
                    padding: 4px 12px; /* macOS 默认 padding 较小 */
                }}
                /* 针对小图标按钮 */
                #canvasToolbarButton {{
                    padding: 4px;
                }}
                /* 强制覆盖浮动工具栏按钮样式 */
                #modernIconButton, #modernIconButton:checked {{
                    padding: 4px 4px;
                    font-size: {img_tool_font}px;
                    icon-size: {img_tool_icon}px;
                    font-weight: normal; /* 移除加粗 */
                }}
                /* 启动页标题适配 */
                #splashTitle {{
                    font-size: {splash_title_font}px;
                }}
                
                /* ===== 网格模式侧边栏深度适配 ===== */
                /* 侧边栏主标题 */
                #leftHeader {{
                    font-size: 15px;
                    min-height: 40px;
                    padding: 12px 12px;
                }}
                /* 通用标签页 */
                QTabBar::tab {{
                    font-size: 12px;
                    padding: 6px 10px;
                    margin-right: 1px;
                    min-width: 60px;
                }}
                /* 区域标题 */
                #cardTitle, #uploadSectionLabel, #promptSectionLabel, #settingsSectionLabel {{
                    font-size: 13px;
                    margin-bottom: 4px;
                    margin-top: 2px;
                }}
                /* 主处理标签页 (单张/批量) */
                QTabWidget#mainProcessTabs QTabBar::tab {{
                    padding: 8px 12px;
                    margin: 4px;
                    font-size: 13px;
                }}
                /* 卡片内边距紧凑化 */
                #uploadCard {{
                    padding: 16px;
                }}
                #settingsCard, #batchCountCard, #promptCard {{
                    padding: 12px;
                }}
                /* 输入框和下拉框紧凑化 */
                #leftPanel QLineEdit, #leftPanel QComboBox, #leftPanel QSpinBox {{
                    padding: 4px 8px;
                    font-size: 12px;
                    min-height: 28px;
                }}
                """
            
            # 6. 右侧面板和模式切换适配
            right_title_font = get_ui_value('main_right_panel', 'title_font_size', default=16)
            mode_switch_font = get_ui_value('mode_switch', 'font_size', default=13)
            
            # 7. 其他文本和按钮适配 (API配置、结果标题)
            api_btn_font = get_ui_value('api_config_widget', 'font_size', default=13)
            grid_header_font = get_ui_value('main_right_panel', 'title_font_size', default=16)
            
            # 获取提示词预设按钮尺寸
            preset_btn_config = get_ui_value('prompt_preset', 'button_size', default=(32, 32))
            preset_btn_size = preset_btn_config[1] if isinstance(preset_btn_config, (list, tuple)) else 32
            
            patch += f"""
            /* 右侧面板标题 */
            #rightHeader {{
                font-size: {right_title_font}px;
                padding: 24px 16px; /* 减小 padding (原 40px 20px) */
            }}
            
            /* 模式切换按钮 */
            QPushButton#modeSwitchBtn {{
                font-size: {mode_switch_font}px;
            }}
            
            /* 7. 其他文本和按钮适配 (API配置、结果标题) */
            #expandBtn, #saveBtn, #clearBtn, #toggleBtn, #usageBtn {{
                font-size: {api_btn_font}px; /* API配置按钮 */
            }}
            
            #gridResultHeader {{
                font-size: {grid_header_font}px; /* 生成结果标题 */
            }}
            
            /* 提示词预设按钮适配 */
            QPushButton#presetBtn {{
                min-width: {preset_btn_size}px;
                min-height: {preset_btn_size}px;
                max-width: {preset_btn_size}px;
                max-height: {preset_btn_size}px;
                padding: 2px;
            }}
            """
            
            return patch
            
        except Exception as e:
            logging.warning(f"生成平台样式补丁失败: {e}")
            return ""

    def _get_variant_theme_config(self) -> Dict[str, str]:
        """获取变体主题配置（用于模板渲染）"""
        if not self.variant:
            return {}
        try:
            from ui_helpers import get_resource_path
            config_file = get_resource_path("variant_config.json")
            with open(config_file, 'r', encoding='utf-8') as f:
                config = json.load(f)
            variant_config = config.get(self.variant, {})
            return variant_config.get('variant_theme', {}) or {}
        except Exception as e:
            logging.warning(f"读取变体主题配置失败: {e}")
            return {}

    def _build_theme_tokens(self) -> Dict[str, str]:
        """构建模板渲染用的颜色 token 映射"""
        is_dark = self.theme == 'dark'
        tokens = ThemeColors.build_style_tokens(is_dark)

        tokens.update(self._get_variant_theme_config())
        return tokens

    def _get_template_content(self, filename: str) -> Optional[str]:
        """读取模板内容（如果存在）"""
        if not self.use_template_runtime:
            return None
        templates_dir = os.path.join(self.styles_dir, 'templates')
        template_path = os.path.join(templates_dir, f"variant_{filename}.template")
        if not os.path.exists(template_path):
            return None
        try:
            content = open(template_path, 'r', encoding='utf-8').read()
            if content.strip() == "/* 此文件无需主题化 */":
                return None
            return content
        except Exception as e:
            logging.warning(f"读取样式模板失败: {template_path}, 错误: {e}")
            return None

    def _render_template(self, content: str) -> str:
        """渲染模板内容，将占位符替换为颜色 token"""
        tokens = self._build_theme_tokens()
        placeholders = set(re.findall(r"\{\{([A-Z0-9_]+)\}\}", content))
        primary_color = tokens.get('PRIMARY_COLOR', ThemeColors.DEFAULT_PRIMARY_COLOR)
        for key in placeholders:
            value = tokens.get(key, primary_color)
            content = content.replace(f"{{{{{key}}}}}", value)
        return content

    def render_tokens(self, content: str) -> str:
        """对已加载的结构样式进行 token 渲染（颜色补丁层）"""
        return self._render_template(content)

    def _split_token_blocks(self, content: str) -> tuple[str, str]:
        """拆分包含 token 的块与结构块（基于括号深度）"""
        structure_parts = []
        token_parts = []
        buffer = []
        depth = 0

        for ch in content:
            buffer.append(ch)
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth = max(depth - 1, 0)
                if depth == 0:
                    block = "".join(buffer)
                    buffer = []
                    if "{{" in block and "}}" in block:
                        token_parts.append(block)
                    else:
                        structure_parts.append(block)

        if buffer:
            structure_parts.append("".join(buffer))

        return "".join(structure_parts), "\n".join(token_parts)

    def _load_structure_file(self, filename: str) -> str:
        """加载结构样式（模板文件会移除 token 块）"""
        variant_path = self._get_variant_style_path(filename)
        if variant_path:
            try:
                with open(variant_path, 'r', encoding='utf-8') as f:
                    style_content = f.read()
                style_content = self._convert_relative_urls(style_content)
                style_content = self._apply_font_preferences(style_content)
                if sys.platform == 'darwin':
                    style_content = self._adapt_for_macos(style_content, filename)
                return style_content
            except Exception as e:
                logging.error(f"加载变体样式失败: {filename}, 错误: {e}")
                return ""

        template_content = self._get_template_content(filename)
        if template_content:
            structure, _ = self._split_token_blocks(template_content)
            style_content = self._convert_relative_urls(structure)
            style_content = self._apply_font_preferences(style_content)
            if sys.platform == 'darwin':
                style_content = self._adapt_for_macos(style_content, filename)
            return style_content

        return self.load_style_file(filename, render_tokens=False)

    def _load_color_patch(self, filename: str) -> str:
        """加载颜色补丁（仅模板中包含 token 的块）"""
        template_content = self._get_template_content(filename)
        if not template_content:
            file_path = self._resolve_file_path(filename)
            if not file_path:
                return ""
            try:
                content = open(file_path, 'r', encoding='utf-8').read()
                content = self._convert_relative_urls(content)
                content = self._apply_font_preferences(content)
                if sys.platform == 'darwin':
                    content = self._adapt_for_macos(content, filename)
                content = self._inject_color_tokens(content)
                _, token_blocks = self._split_token_blocks(content)
                if not token_blocks.strip():
                    return ""
                return self._render_template(token_blocks)
            except Exception as e:
                logging.warning(f"加载颜色补丁失败: {filename}, 错误: {e}")
                return ""
        _, token_blocks = self._split_token_blocks(template_content)
        if not token_blocks.strip():
            return ""
        patch = self._render_template(token_blocks)
        patch = self._convert_relative_urls(patch)
        patch = self._apply_font_preferences(patch)
        if sys.platform == 'darwin':
            patch = self._adapt_for_macos(patch, filename)
        return patch

    def _inject_color_tokens(self, content: str) -> str:
        """在非模板 QSS 中注入已知品牌色 token 占位符"""
        token_map = {
            '#e83ed5': '{{PRIMARY_COLOR}}',
            '#fd952d': '{{PRIMARY_LIGHT}}',
            '#9810fa': '{{PRIMARY_COLOR}}',
            '#ce66ff': '{{PRIMARY_COLOR}}',
            '#7f22fe': '{{PRIMARY_COLOR}}',
            '#374151': '{{QT_TEXT_PRIMARY}}',
            '#e5e7eb': '{{QT_BORDER}}',
            '#f3f4f6': '{{QT_BG_SUBTLE}}',
            '#9ca3af': '{{QT_TEXT_MUTED}}',
            '#3b82f6': '{{UI_INFO_MAIN}}',
            '#2563eb': '{{UI_INFO_HOVER}}',
            '#1d4ed8': '{{UI_INFO_PRESSED}}',
            '#5b7fff': '{{UI_BLUE_MAIN}}',
            '#4c6edb': '{{UI_BLUE_HOVER}}',
            '#3d5ec7': '{{UI_BLUE_PRESSED}}',
            '#2196f3': '{{UI_ACCENT_MAIN}}',
            '#1976d2': '{{UI_ACCENT_HOVER}}',
            '#2b2b2b': '{{QT_BG_PANEL}}',
            '#3a3a3a': '{{QT_BORDER}}',
            '#e5e5e5': '{{QT_TEXT_PRIMARY}}',
            '#666666': '{{QT_TEXT_MUTED}}',
        }
        for color_hex, token in token_map.items():
            pattern = re.compile(re.escape(color_hex), re.IGNORECASE)
            content = pattern.sub(token, content)
        return content

    def _apply_font_preferences(self, content: str) -> str:
        """Normalize legacy font-family declarations to the current app default chain."""
        try:
            from ui.font_config import FontConfig

            replacements = {
                '"Segoe UI", "Microsoft YaHei UI", "PingFang SC", ".AppleSystemUIFont", "WenQuanYi Micro Hei", sans-serif':
                    FontConfig.get_qss_font_family_value(),
                "'Segoe UI', 'Microsoft YaHei', sans-serif":
                    FontConfig.get_qss_font_family_value(),
                '"Microsoft YaHei UI"':
                    FontConfig.get_qss_font_family_value(),
            }
            for legacy, current in replacements.items():
                content = content.replace(legacy, current)
        except Exception:
            return content
        return content

    def _get_variant_style_path(self, filename: str) -> Optional[str]:
        """获取变体样式文件路径（存在才返回）"""
        if not self.variant:
            return None
        variant_path = os.path.join(self.styles_dir, 'variants', self.variant, filename)
        if os.path.exists(variant_path):
            return variant_path
        return None

    def load_style_file(self, filename: str, render_tokens: bool = True) -> str:
        """
        加载单个样式文件，优先从变体目录加载，并进行平台适配
        
        Args:
            filename: 样式文件名
            render_tokens: 是否渲染模板 token
            
        Returns:
            str: 样式内容，失败返回空字符串
        """
        style_content = ""
        
        # 检查缓存
        render_suffix = "render" if render_tokens else "raw"
        cache_key = f"{self.variant}_{filename}_{render_suffix}" if self.variant else f"{filename}_{render_suffix}"
        if cache_key in self.cache:
            return self.cache[cache_key]
        
        # 优先使用变体样式文件
        variant_path = self._get_variant_style_path(filename)
        if variant_path:
            file_path = variant_path
        else:
            template_content = self._get_template_content(filename)
            if template_content:
                style_content = self._render_template(template_content) if render_tokens else template_content
                style_content = self._convert_relative_urls(style_content)
                style_content = self._apply_font_preferences(style_content)
                if sys.platform == 'darwin':
                    style_content = self._adapt_for_macos(style_content, filename)
                self.cache[cache_key] = style_content
                logging.debug(f"加载样式模板: {filename} (已渲染)")
                return style_content

            # 路径查找逻辑...
            file_path = self._resolve_file_path(filename)
        
        if not file_path:
            return ""
            
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                style_content = f.read()
                
                # ✅ 将 QSS 中的相对路径转换为绝对路径（解决打包后资源路径问题）
                style_content = self._convert_relative_urls(style_content)
                style_content = self._apply_font_preferences(style_content)
                
                # ✅ 核心修改：进行平台适配
                if sys.platform == 'darwin':
                    style_content = self._adapt_for_macos(style_content, filename)
                
                self.cache[cache_key] = style_content
                logging.debug(f"加载样式文件: {filename} (已适配)")
                return style_content
        except Exception as e:
            logging.error(f"加载样式文件失败: {filename}, 错误: {e}")
            return ""

    def _resolve_file_path(self, filename: str) -> str:
        """解析文件路径（提取自原 load_style_file）"""
        # 如果指定了变体，优先尝试变体目录
        if self.variant:
            variant_path = os.path.join(self.styles_dir, 'variants', self.variant, filename)
            if os.path.exists(variant_path):
                return variant_path
        
        # 回退到默认样式文件
        file_path = os.path.join(self.styles_dir, filename)
        
        # 兼容旧版
        if not os.path.exists(file_path):
            if filename == 'base.qss':
                old_path = os.path.join(os.path.dirname(self.styles_dir), 'style.qss')
                if os.path.exists(old_path):
                    return old_path
        
        if os.path.exists(file_path):
            return file_path
        
        logging.warning(f"样式文件不存在: {filename}")
        return ""

    def _convert_relative_urls(self, content: str) -> str:
        """
        将 QSS 中的相对路径转换为绝对路径
        
        解决打包后 exe 工作目录不是应用目录导致资源路径解析失败的问题。
        例如: url(assits/icon.svg) -> url(D:/app/assits/icon.svg)
        """
        import re
        
        # 获取应用根目录
        if getattr(sys, 'frozen', False):
            if hasattr(sys, '_MEIPASS'):
                base_dir = sys._MEIPASS
            else:
                base_dir = os.path.dirname(sys.executable)
                internal_dir = os.path.join(base_dir, '_internal')
                if os.path.exists(internal_dir):
                    base_dir = internal_dir
        else:
            # 开发环境：styles 目录的父目录
            base_dir = os.path.dirname(self.styles_dir)
        
        def replace_url(match):
            url_path = match.group(1)
            # 跳过已经是绝对路径或网络路径的
            if url_path.startswith(('/', 'http://', 'https://', 'file://')):
                return match.group(0)
            # 跳过 Windows 绝对路径 (如 C:/)
            if len(url_path) > 1 and url_path[1] == ':':
                return match.group(0)
            
            # 转换为绝对路径，使用正斜杠（QSS 要求）
            abs_path = os.path.join(base_dir, url_path).replace('\\', '/')
            return f'url({abs_path})'
        
        # 匹配 url(...) 模式
        pattern = r'url\(([^)]+)\)'
        return re.sub(pattern, replace_url, content)
    
    def _adapt_for_macos(self, content: str, filename: str) -> str:
        """
        针对 macOS 对 QSS 内容进行动态替换
        """
        try:
            from ui.configs.ui_adapter import get_ui_value
            
            # 1. 优先使用 macOS 系统字体
            # 将 .AppleSystemUIFont 放在最前面
            if "font-family:" in content:
                # 查找并替换 QWidget 的字体定义
                # 这是一个简单的替换，假设原始 QSS 中也是这个顺序
                content = content.replace(
                    '"Segoe UI", "Microsoft YaHei UI", "PingFang SC", ".AppleSystemUIFont"',
                    '".AppleSystemUIFont", "PingFang SC", "Segoe UI", "Microsoft YaHei UI"'
                )
            
            # 只适配模式切换按钮
            if filename == 'base.qss':
                # 1. 替换模式切换按钮高度 (38px -> 32px)
                mode_switch_height = get_ui_value('mode_switch', 'height', default=32)
                content = content.replace('min-height: 38px;', f'min-height: {mode_switch_height}px;')
                
                # 2. 替换模式切换按钮圆角 (20px -> 16px)
                content = content.replace('border-radius: 20px;', 'border-radius: 16px;')
            
            logging.debug(f"已对 {filename} 进行 macOS 内容适配")
            return content
            
        except Exception as e:
            logging.warning(f"macOS 样式适配失败: {e}")
            return content
    
    def get_styles_directory(self) -> str:
        """
        获取样式目录路径
        
        Returns:
            str: 样式目录的绝对路径
        """
        if getattr(sys, 'frozen', False):
            # 打包后的exe
            # PyInstaller 会将资源文件放在 _MEIPASS 或 _internal 目录
            if hasattr(sys, '_MEIPASS'):
                # 单文件打包模式（临时目录）
                return os.path.join(sys._MEIPASS, 'styles')
            else:
                # 目录打包模式（_internal目录）
                base_path = os.path.dirname(sys.executable)
                # 检查 _internal 目录
                internal_styles = os.path.join(base_path, '_internal', 'styles')
                if os.path.exists(internal_styles):
                    return internal_styles
                # 回退到直接在exe目录下
                return os.path.join(base_path, 'styles')
        else:
            # 开发环境
            current_dir = os.path.dirname(os.path.abspath(__file__))
            return current_dir
    
    def clear_cache(self):
        """清空样式缓存"""
        self.cache.clear()
        logging.info("样式缓存已清空")
    
    def reload_style(self, filename: str) -> str:
        """
        重新加载指定样式文件（忽略缓存）
        
        Args:
            filename: 样式文件名
            
        Returns:
            str: 样式内容
        """
        if filename in self.cache:
            del self.cache[filename]
        return self.load_style_file(filename)
