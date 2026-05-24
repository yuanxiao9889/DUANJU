# -*- coding: utf-8 -*-
"""提示词库浏览器打开模块"""
import os
import logging
import traceback
from PyQt5.QtCore import Qt, QTimer, QEvent, QUrl
from PyQt5.QtGui import QCursor, QDesktopServices
from PyQt5.QtWidgets import QDialog, QVBoxLayout, QHBoxLayout, QPushButton, QLabel, QWidget, QApplication, QMessageBox

from utils import get_resource_path


def open_prompt_library_in_browser(parent=None, log_file_path=None):
    html_path = get_resource_path("nano_banana_prompts_reference.html")
    logging.info(f"HTML文件路径: {html_path}")
    logging.info(f"HTML文件是否存在: {os.path.exists(html_path)}")

    try:
        if not os.path.exists(html_path):
            error_msg = f"文件不存在：{html_path}"
            logging.error(error_msg)
            if parent is not None:
                QMessageBox.warning(parent, "错误", error_msg + f"\n\n日志文件: {log_file_path or '未创建'}")
            return False

        opened = QDesktopServices.openUrl(QUrl.fromLocalFile(html_path))
        if not opened:
            raise RuntimeError("系统未接受打开请求")

        logging.info(f"在浏览器中打开: {html_path}")
        return True
    except Exception as e:
        error_msg = f"打开浏览器失败: {str(e)}"
        logging.error(f"{error_msg}\n{traceback.format_exc()}")
        if parent is not None:
            QMessageBox.critical(parent, "错误", error_msg)
        return False


class PromptLibraryDialog(QDialog):
    """提示词库浏览器打开兼容对话框"""
    def __init__(self, parent=None, log_file_path=None):
        try:
            super().__init__(parent)
            self.setWindowTitle("🍌 Nano Banana 提示词库")
            self.setMinimumSize(1200, 800)
            self.log_file_path = log_file_path
            
            # 设置为非模态对话框，允许点击外部关闭
            self.setModal(False)
            
            # 标记是否成功初始化
            self.init_success = False
            
            logging.info("PromptLibraryDialog 开始初始化...")
        except Exception as e:
            logging.error(f"PromptLibraryDialog 基础初始化失败: {str(e)}\n{traceback.format_exc()}")
            self.init_success = False
            raise
        
        # 安全地安装应用级别的事件过滤器
        try:
            app = QApplication.instance()
            if app:
                app.installEventFilter(self)
        except Exception as e:
            logging.error(f"安装事件过滤器失败: {e}")
        
        # 设置窗口图标（如果有的话）
        try:
            if parent and hasattr(parent, 'windowIcon'):
                self.setWindowIcon(parent.windowIcon())
        except Exception as e:
            logging.error(f"设置窗口图标失败: {e}")
        
        # 创建布局
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        
        # 获取HTML文件路径（使用资源路径函数以兼容打包环境）
        html_path = get_resource_path("nano_banana_prompts_reference.html")
        logging.info(f"HTML文件路径: {html_path}")
        logging.info(f"HTML文件是否存在: {os.path.exists(html_path)}")
        self._html_path = html_path
        self._create_browser_open_view(layout, html_path)
        self.init_success = True
        QTimer.singleShot(0, self._open_in_browser_once)
        
        # 添加关闭按钮
        try:
            close_btn_layout = QHBoxLayout()
            close_btn_layout.setContentsMargins(0, 10, 0, 10)

            close_btn = QPushButton("关闭")
            close_btn.setMinimumHeight(35)
            close_btn.setFixedWidth(360)  # 固定宽度360px (约为1200px的30%)
            close_btn.setCursor(Qt.PointingHandCursor)  # 设置手型光标
            close_btn.clicked.connect(self.close)
            
            close_btn_layout.addStretch()
            close_btn_layout.addWidget(close_btn)
            close_btn_layout.addStretch()
            
            layout.addLayout(close_btn_layout)
            logging.info("关闭按钮添加成功")
        except Exception as e:
            logging.error(f"添加关闭按钮失败: {str(e)}\n{traceback.format_exc()}")
            # 按钮添加失败不影响对话框显示
    
    def _create_browser_open_view(self, layout, html_path):
        """创建浏览器打开视图"""
        try:
            info_widget = QWidget()
            info_layout = QVBoxLayout(info_widget)
            info_layout.setAlignment(Qt.AlignCenter)
            info_layout.setSpacing(20)

            info_label = QLabel(
                "<h2>🍌 Nano Banana 提示词库</h2>"
                "<p style='color: #7f8c8d;'>提示词库将通过系统默认浏览器打开</p>"
            )
            info_label.setAlignment(Qt.AlignCenter)
            info_label.setWordWrap(True)
            info_layout.addWidget(info_label)

            if self.log_file_path:
                log_hint = QLabel(
                    f"<p style='color: #95a5a6; font-size: 11px;'>如需查看详细错误信息，请查看日志文件：<br>{self.log_file_path}</p>"
                )
                log_hint.setAlignment(Qt.AlignCenter)
                log_hint.setWordWrap(True)
                log_hint.setTextInteractionFlags(Qt.TextSelectableByMouse)
                info_layout.addWidget(log_hint)
            
            open_browser_btn = QPushButton("🌐 在浏览器中打开")
            open_browser_btn.setMinimumHeight(40)
            open_browser_btn.setMaximumWidth(300)
            open_browser_btn.setCursor(Qt.PointingHandCursor)
            open_browser_btn.clicked.connect(self._open_in_browser_once)
            info_layout.addWidget(open_browser_btn, alignment=Qt.AlignCenter)
            
            layout.addWidget(info_widget)
        except Exception as e:
            logging.error(f"创建浏览器打开视图失败: {str(e)}\n{traceback.format_exc()}")
    
    def _open_in_browser_once(self):
        if getattr(self, '_browser_opened', False):
            return

        self._browser_opened = True
        self.open_in_browser(self._html_path)

    def open_in_browser(self, html_path):
        """在系统默认浏览器中打开HTML文件"""
        open_prompt_library_in_browser(self, self.log_file_path)
    
    def eventFilter(self, obj, event):
        """事件过滤器：监听鼠标点击事件"""
        # 排除拖放相关的事件，避免干扰主窗口的拖放功能
        if event.type() in (QEvent.DragEnter, QEvent.DragMove, QEvent.DragLeave, 
                           QEvent.Drop, QEvent.MouseMove):
            return False  # 不处理拖放和鼠标移动事件
        
        if event.type() == QEvent.MouseButtonPress:
            # 获取点击位置和被点击的控件
            clicked_widget = QApplication.widgetAt(QCursor.pos())
            
            # 如果点击的不是本窗口或其子控件，则关闭
            if clicked_widget is not None:
                if not (clicked_widget == self or self.isAncestorOf(clicked_widget)):
                    # 使用 QTimer 延迟关闭，避免中断正在进行的事件序列
                    QTimer.singleShot(0, self.close)
                    return False
        return False  # 不拦截事件，让其继续传播
    
    def closeEvent(self, event):
        """关闭事件：移除事件过滤器"""
        try:
            app = QApplication.instance()
            if app:
                app.removeEventFilter(self)
            logging.info("提示词库浏览器打开兼容窗口关闭")
        except Exception as e:
            logging.error(f"关闭对话框时出错: {e}")

        super().closeEvent(event)
    
    def showEvent(self, event):
        """窗口显示时的事件"""
        super().showEvent(event)
        # 确保窗口激活并获得焦点
        self.activateWindow()
        self.raise_()
