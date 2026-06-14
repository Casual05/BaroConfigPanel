"""Barotrauma 配置面板 - 入口"""
import sys
import os
import webview
from api import Api

def get_frontend_path():
    """获取前端文件路径（开发时用目录，打包后走 sys._MEIPASS）"""
    if getattr(sys, 'frozen', False):
        base = sys._MEIPASS
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, 'frontend', 'index.html')


def main():
    api = Api()
    window = webview.create_window(
        title='潜渊症配置面板 - Barotrauma Config Panel',
        url=get_frontend_path(),
        js_api=api,
        width=1100,
        height=800,
        min_size=(900, 600),
        resizable=True,
    )
    # edgechromium = Windows 10/11 自带 WebView2，无需额外装 pythonnet/cef
    webview.start(debug=False, gui='edgechromium')


if __name__ == '__main__':
    main()
