# Barotrauma 配置面板 (潜渊症)

一个 Windows 桌面工具，用于可视化修改 Barotrauma 的客户端配置和服务端配置。

## 功能

### 🧩 模组管理
- 导入 Workshop 模组清单（`6.9.xml` 格式）
- 拖拽排序调整模组加载顺序
- 勾选启用/禁用单个模组
- 一键保存到 `config_player.xml`
- 每次保存自动创建时间戳备份

### 🖥️ 服务器设置
- 分组可视化编辑关键服务器参数
- 支持字段类型：文本、数字、开关、下拉、百分比
- 中文界面 + 中文选项标签
- 一键保存到 `serversettings.xml`

### 📂 备份管理
- 每次保存自动创建时间戳备份（`.baro_backups/`）
- 可视化备份列表，按时间倒序
- 一键恢复，恢复前自动备份当前文件

## 使用方法

### 方式一：直接运行（推荐）
下载 `BaroConfigPanel.exe`，扔到你的 Barotrauma 游戏目录：
```
您的游戏文件夹/
├── BaroConfigPanel.exe     ← 放这里
├── config_player.xml        ← 自动识别
├── serversettings.xml        ← 自动识别
└── ...
```
双击 exe，所有配置自动加载，改完直接保存。

### 方式二：拖入文件
将任意 XML 文件拖入窗口：
- `config_player.xml` → 自动加载模组列表
- `serversettings.xml` → 自动加载服务器设置
- 其他 `*.xml`（如 `6.9.xml`）→ 自动解析为模组清单

### 方式三：手动选择
点击顶部栏的「选择文件」按钮手动选取文件。

## 从源码运行

```bash
pip install pywebview
python main.py
```

## 打包 exe

```bash
pip install pyinstaller pywebview
build.bat
# 或手动打包：
pyinstaller --onefile --windowed --name "BaroConfigPanel" --add-data "frontend;frontend" main.py
```

## 技术栈
- **后端**: Python 3.10+（xml.etree.ElementTree）
- **前端**: HTML + CSS + JavaScript
- **桌面窗口**: pywebview（Edge Chromium WebView2）
- **打包**: PyInstaller（单文件 exe，~21MB）

## 文件结构
```
baro-config-panel/
├── main.py              # 程序入口
├── backend.py           # XML 解析/读写核心
├── api.py               # pywebview JS Bridge API
├── frontend/
│   ├── index.html       # 界面布局
│   ├── style.css         # 样式
│   └── script.js        # 前端逻辑
├── requirements.txt     # 依赖
├── build.bat            # 打包脚本
├── .gitignore
└── README.md
```
