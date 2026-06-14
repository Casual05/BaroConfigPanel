"""pywebview JS Bridge API — 前端通过 pywebview.api.xxx() 调用"""

import os
import sys
from tkinter import filedialog, Tk
from typing import Any

import backend


class Api:
    """暴露给前端 JavaScript 的 API"""

    def __init__(self):
        self._config_path = ''
        self._server_path = ''
        self._detected_config = ''
        self._detected_server = ''
        self._detected_modlist = ''
        self._auto_detect()

    def _auto_detect(self):
        """自动检测当前目录下的配置文件"""
        prog_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
        cfg = os.path.join(prog_dir, 'config_player.xml')
        sv  = os.path.join(prog_dir, 'serversettings.xml')
        if os.path.isfile(cfg):
            self._config_path = cfg
            self._detected_config = cfg
        if os.path.isfile(sv):
            self._server_path = sv
            self._detected_server = sv
        # 检测 ModList 目录下的 xml
        modlist = self._auto_detect_modlist(prog_dir)
        if modlist:
            self._detected_modlist = modlist

    def _is_modlist_xml(self, path: str) -> bool:
        """检查 XML 文件是否为 Workshop 模组清单（根元素为 <mods>，含 <Workshop> 子节点）"""
        try:
            import xml.etree.ElementTree as ET
            tree = ET.parse(path)
            root = tree.getroot()
            if root.tag != 'mods':
                return False
            for child in root:
                if child.tag == 'Workshop':
                    return True
            return False
        except Exception:
            return False

    def _auto_detect_modlist(self, base_dir: str) -> str:
        """扫描目录及 ModList/ 子目录，找到第一个有效的模组清单 XML"""
        import glob
        # 先扫 ModList/ 子目录
        for sub in ['ModList', 'modlist', 'Modlist', 'mods', 'Mods']:
            d = os.path.join(base_dir, sub)
            if os.path.isdir(d):
                for f in sorted(glob.glob(os.path.join(d, '*.xml'))):
                    if self._is_modlist_xml(f):
                        return f
        # 再扫当前目录（排除已知配置文件名）
        exclude = {'config_player.xml', 'serversettings.xml'}
        for f in sorted(glob.glob(os.path.join(base_dir, '*.xml'))):
            if os.path.basename(f).lower() in exclude:
                continue
            if self._is_modlist_xml(f):
                return f
        return ''

    # ── 文件检测 ───────────────────────────────────────────

    def get_detected_files(self) -> dict:
        """返回自动检测到的文件路径（含模组清单）"""
        return {
            'config': self._detected_config,
            'server': self._detected_server,
            'modlist': self._detected_modlist,
        }

    def set_file_path(self, file_type: str, file_path: str) -> dict:
        """接收拖入的文件路径，file_type: 'config' / 'server' / 'import'"""
        if not os.path.isfile(file_path):
            return {'ok': False, 'error': '文件不存在'}
        if file_type == 'config':
            self._config_path = file_path
        elif file_type == 'server':
            self._server_path = file_path
        elif file_type == 'import':
            # import 类型不设路径，只验证存在
            pass
        return {'ok': True, 'path': file_path}

    # ── 文件选择 ────────────────────────────────────────────

    def _pick_xml_file(self, title: str) -> str:
        """用系统文件对话框选 XML 文件"""
        root = Tk()
        root.withdraw()
        root.attributes('-topmost', True)
        path = filedialog.askopenfilename(
            title=title,
            filetypes=[('XML files', '*.xml'), ('All files', '*.*')],
        )
        root.destroy()
        return path

    def select_config_file(self) -> str:
        """选择 config_player.xml"""
        path = self._pick_xml_file('选择 config_player.xml')
        if path:
            self._config_path = path
        return path

    def select_server_file(self) -> str:
        """选择 serversettings.xml"""
        path = self._pick_xml_file('选择 serversettings.xml')
        if path:
            self._server_path = path
        return path

    def select_import_file(self) -> str:
        """选择要导入的 ModList 下的 XML 文件"""
        return self._pick_xml_file('选择模组清单 XML 文件')

    def get_current_dir(self) -> str:
        """返回程序所在目录（方便用户知道默认路径）"""
        return os.path.abspath(os.path.dirname(sys.argv[0]))

    # ── 拖入文件处理 ──────────────────────────────────────

    def save_dropped_file(self, file_type: str, content: str, filename: str) -> dict:
        """保存拖入的文件内容到托管目录，返回路径"""
        drop_dir = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), '.baro_dropped')
        os.makedirs(drop_dir, exist_ok=True)
        save_path = os.path.join(drop_dir, filename)
        with open(save_path, 'w', encoding='utf-8') as f:
            f.write(content)
        if file_type == 'config':
            self._config_path = save_path
        elif file_type == 'server':
            self._server_path = save_path
        return {'ok': True, 'path': save_path}

    # ── 模组导入 ────────────────────────────────────────────

    def import_modlist(self, xml_path: str) -> list[dict]:
        """解析 Workshop modlist，返回有序模组列表"""
        if not os.path.isfile(xml_path):
            raise FileNotFoundError(f'文件不存在: {xml_path}')
        return backend.parse_workshop_modlist(xml_path)

    def import_modlist_from_content(self, content: str, filename: str) -> list[dict]:
        """从文本内容解析模组清单（拖入用）"""
        import tempfile
        tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.xml', delete=False, encoding='utf-8')
        tmp.write(content)
        tmp_path = tmp.name
        tmp.close()
        try:
            return backend.parse_workshop_modlist(tmp_path)
        finally:
            os.unlink(tmp_path)

    # ── config_player.xml ───────────────────────────────────

    def load_config(self) -> dict[str, Any]:
        """加载 config_player.xml 数据"""
        if not self._config_path or not os.path.isfile(self._config_path):
            return {'error': '请先选择 config_player.xml'}
        return backend.load_config(self._config_path)

    def save_config(self, mods: list[dict]) -> bool:
        """保存模组列表到 config_player.xml"""
        if not self._config_path:
            raise ValueError('未选择 config_player.xml')
        backend.save_config(self._config_path, mods)
        return True

    # ── serversettings.xml ──────────────────────────────────

    def load_serversettings(self) -> dict[str, Any]:
        """加载 serversettings.xml 数据"""
        if not self._server_path or not os.path.isfile(self._server_path):
            return {'error': '请先选择 serversettings.xml'}
        return backend.load_serversettings(self._server_path)

    def save_serversettings(self, data: dict[str, Any]) -> bool:
        """保存服务器设置"""
        if not self._server_path:
            raise ValueError('未选择 serversettings.xml')
        backend.save_serversettings(self._server_path, data)
        return True

    # ── 备份管理 ────────────────────────────────────────────

    def list_backups(self, file_type: str) -> list[dict]:
        """列出备份 file_type: 'config' 或 'server'"""
        path = self._config_path if file_type == 'config' else self._server_path
        if not path or not os.path.isfile(path):
            return []
        return backend.list_backups(path)

    def restore_backup(self, file_type: str, backup_name: str) -> bool:
        """从备份恢复"""
        path = self._config_path if file_type == 'config' else self._server_path
        if not path:
            raise ValueError('请先选择对应的 XML 文件')
        backend.restore_backup(path, backup_name)
        return True

    def get_backup_dir(self, file_type: str) -> str:
        """获取备份目录路径"""
        path = self._config_path if file_type == 'config' else self._server_path
        if not path:
            return ''
        return backend._get_backup_dir(path)

    # ── 字段元信息 ──────────────────────────────────────────

    def get_field_info(self) -> dict:
        """返回类型映射和选项表，前端用来决定渲染控件"""
        return {
            'type_map': backend.FIELD_TYPE_MAP,
            'select_options': backend.SELECT_OPTIONS,
            'key_fields': backend.KEY_SERVER_FIELDS,
        }
