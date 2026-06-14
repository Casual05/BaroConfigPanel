"""XML 读写后端 — 用 xml.etree.ElementTree 解析/修改/序列化"""

import xml.etree.ElementTree as ET
import os
import shutil
import glob
from datetime import datetime
from typing import Any

# ── 模组导入（6.9.xml → 解析） ─────────────────────────────────

def parse_workshop_modlist(xml_path: str) -> list[dict]:
    """解析 Workshop 导出的 modlist XML（如 6.9.xml），返回有序列表"""
    tree = ET.parse(xml_path)
    root = tree.getroot()
    mods = []
    for child in root:
        tag = child.tag
        if tag == 'Vanilla':
            mods.append({'name': 'Vanilla', 'workshop_id': None, 'enabled': True})
        elif tag == 'Workshop':
            mods.append({
                'name': child.get('name', ''),
                'workshop_id': child.get('id', ''),
                'enabled': True,
            })
    return mods


def build_regularpackages_xml(mods: list[dict]) -> str:
    """根据 mods 列表生成 <regularpackages>...</regularpackages> 的 XML 文本"""
    lines = ['    <regularpackages>']
    for m in mods:
        if m.get('workshop_id') is None:
            continue  # Vanilla 是 corepackage，不在这里
        wid = m['workshop_id']
        name = m.get('name', '')
        indent = '      '
        if m.get('enabled', True):
            lines.append(f'{indent}<!--{name}-->')
            lines.append(f'{indent}<package path="LocalMods/{wid}/filelist.xml" />')
        # 禁用的模组不写入（或者可以注释掉？直接跳过更干净）
    lines.append('    </regularpackages>')
    return '\n'.join(lines)


# ── config_player.xml 读写 ────────────────────────────────────

def load_config(xml_path: str) -> dict[str, Any]:
    """读取 config_player.xml，返回结构化数据"""
    parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))
    tree = ET.parse(xml_path, parser=parser)
    root = tree.getroot()

    # 基础属性
    result: dict[str, Any] = {}
    for attr in ['language', 'verboselogging', 'maxautosaves', 'autosaveintervalseconds',
                 'showenemyhealthbars', 'enablemouselook', 'disableingamehints',
                 'crossplaychoice', 'framelimit', 'particlelimit']:
        result[attr] = root.get(attr, '')

    # graphics
    gs = root.find('graphicssettings')
    if gs is not None:
        result['display'] = gs.get('width', '1920') + 'x' + gs.get('height', '1080')
        result['displaymode'] = gs.get('displaymode', '')

    # 模组列表
    content = root.find('contentpackages')
    if content is not None:
        rp = content.find('regularpackages')
        if rp is not None:
            mods = []
            for pkg in rp.findall('package'):
                path = pkg.get('path', '')
                # 找前一个注释作为名字
                prev = None
                for sib in rp:
                    if sib == pkg:
                        break
                    prev = sib
                name = ''
                if prev is not None and prev.tag is ET.Comment:
                    name = prev.text.strip() if prev.text else ''
                wid = ''
                if 'LocalMods/' in path:
                    wid = path.split('LocalMods/')[1].split('/')[0]
                mods.append({
                    'name': name,
                    'workshop_id': wid,
                    'enabled': True,
                })
            result['mods'] = mods

    return result


def save_config(xml_path: str, mods: list[dict]) -> None:
    """用新的模组列表更新 config_player.xml 的 <regularpackages> 段"""
    parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))
    tree = ET.parse(xml_path, parser=parser)
    root = tree.getroot()

    content = root.find('contentpackages')
    if content is None:
        raise ValueError('config.xml 缺少 <contentpackages>')

    # 移除旧的 regularpackages
    old_rp = content.find('regularpackages')
    if old_rp is not None:
        content.remove(old_rp)

    # 构建新的 regularpackages 元素
    new_rp = ET.SubElement(content, 'regularpackages')
    for m in mods:
        if m.get('workshop_id') is None or not m.get('enabled', True):
            continue
        wid = m['workshop_id']
        name = m.get('name', '')
        # 注释
        comment = ET.Comment(f' {name} ')
        new_rp.append(comment)
        # package 元素
        pkg = ET.SubElement(new_rp, 'package')
        pkg.set('path', f'LocalMods/{wid}/filelist.xml')

    # 写回文件（创建时间戳备份）
    _create_backup(xml_path)

    # 漂亮的序列化输出
    _indent_xml(root)
    tree.write(xml_path, encoding='utf-8', xml_declaration=True)


# ── serversettings.xml 读写 ──────────────────────────────────

# 关键字段白名单（只展示和修改这些）
KEY_SERVER_FIELDS = [
    # 基础
    'ServerName', 'password', 'port', 'queryport', 'MaxPlayers',
    'IsPublic', 'Language',
    # 性能
    'TickRate',
    # 机器人
    'BotCount', 'MaxBotCount',
    # 超时/同步
    'TimeoutThresholdInGame', 'TimeoutThresholdNotInGame',
    'KillDisconnectedTime', 'KickAFKTime',
    'VoteTimeout', 'MinimumMidRoundSyncTimeout',
    'RoundStartSyncDuration', 'EventRemovalTime',
    'OldEventKickTime', 'OldReceivedEventKickTime',
    'DespawnDisconnectedPermadeathTime',
    # 游戏规则
    'AllowFriendlyFire', 'AllowVoteKick', 'AllowEndVoting',
    'RespawnMode', 'RespawnInterval',
    'TraitorProbability', 'TraitorsMinPlayerCount',
    'KarmaEnabled', 'IronmanMode',
    'GameModeIdentifier', 'SelectedSubmarine',
    'ModeSelectionMode', 'SubSelectionMode',
    'PlayStyle', 'LosMode', 'ShowEnemyHealthBars',
    'AutoRestart', 'AutoRestartInterval',
    'MaxLagCompensation',
    # 投票
    'VoteRequiredRatio', 'KickVoteRequiredRatio',
    'EndVoteRequiredRatio',
    # 杂项
    'AllowSpectating', 'VoiceChatEnabled',
    'ServerMessageText',
    'AllowModDownloads', 'AllowFileTransfers',
    'AllowRemoteCampaignInteractions',
]

FIELD_TYPE_MAP: dict[str, str] = {
    'ServerName': 'text',
    'ServerMessageText': 'textarea',
    'password': 'text',
    'port': 'number',
    'queryport': 'number',
    'MaxPlayers': 'number',
    'BotCount': 'number',
    'MaxBotCount': 'number',
    'TickRate': 'number',
    'TimeoutThresholdInGame': 'number',
    'TimeoutThresholdNotInGame': 'number',
    'KillDisconnectedTime': 'number',
    'KickAFKTime': 'number',
    'VoteTimeout': 'number',
    'MinimumMidRoundSyncTimeout': 'number',
    'RoundStartSyncDuration': 'number',
    'EventRemovalTime': 'number',
    'OldEventKickTime': 'number',
    'OldReceivedEventKickTime': 'number',
    'DespawnDisconnectedPermadeathTime': 'number',
    'MaxLagCompensation': 'number',
    'RespawnInterval': 'number',
    'AutoRestartInterval': 'number',
    'TraitorProbability': 'number',
    'TraitorsMinPlayerCount': 'number',
    'VoteRequiredRatio': 'percentage',
    'KickVoteRequiredRatio': 'percentage',
    'EndVoteRequiredRatio': 'percentage',
    'AllowFriendlyFire': 'bool',
    'AllowVoteKick': 'bool',
    'AllowEndVoting': 'bool',
    'AllowSpectating': 'bool',
    'AllowModDownloads': 'bool',
    'AllowFileTransfers': 'bool',
    'AllowRemoteCampaignInteractions': 'bool',
    'VoiceChatEnabled': 'bool',
    'IsPublic': 'bool',
    'KarmaEnabled': 'bool',
    'IronmanMode': 'bool',
    'AutoRestart': 'bool',
    'RespawnMode': 'select',
    'PlayStyle': 'select',
    'LosMode': 'select',
    'ShowEnemyHealthBars': 'select',
    'GameModeIdentifier': 'select',
    'ModeSelectionMode': 'select',
    'SubSelectionMode': 'select',
    'Language': 'select',
    'ShowEnemyHealthBars': 'select',
}

SELECT_OPTIONS: dict[str, list[str]] = {
    'RespawnMode': ['MidRound', 'BetweenRounds', 'NoRespawn'],
    'PlayStyle': ['Serious', 'Casual', 'Rampage', 'Roleplay', 'SomethingDifferent'],
    'LosMode': ['Transparent', 'Opaque', 'None'],
    'ShowEnemyHealthBars': ['ShowAll', 'ShowOnlyWithSonar', 'Hidden'],
    'GameModeIdentifier': ['multiplayercampaign', 'sandbox', 'pvp'],
    'ModeSelectionMode': ['Manual', 'Random', 'Vote'],
    'SubSelectionMode': ['Manual', 'Random', 'Vote', 'Faction'],
    'Language': ['Chinese', 'English'],
}


def load_serversettings(xml_path: str) -> dict[str, Any]:
    """读取 serversettings.xml，只提取白名单字段"""
    tree = ET.parse(xml_path)
    root = tree.getroot()

    data: dict[str, Any] = {}
    for field in KEY_SERVER_FIELDS:
        val = root.get(field)
        if val is not None:
            data[field] = val

    # 也读 campaignsettings（内部子元素）
    cs = root.find('campaignsettings')
    if cs is not None:
        for attr in ['PresetName', 'TutorialEnabled', 'RadiationEnabled',
                      'WorldHostility', 'MaxMissionCount',
                      'CrewVitalityMultiplier', 'NonCrewVitalityMultiplier']:
            val = cs.get(attr)
            if val is not None:
                data[f'campaign_{attr}'] = val

    return data


def save_serversettings(xml_path: str, data: dict[str, Any]) -> None:
    """用新数据更新 serversettings.xml"""
    tree = ET.parse(xml_path)
    root = tree.getroot()

    for key, value in data.items():
        # 处理 campaign_ 前缀 -> 写入子元素
        if key.startswith('campaign_'):
            attr = key[len('campaign_'):]
            cs = root.find('campaignsettings')
            if cs is not None:
                cs.set(attr, str(value))
        else:
            if key in KEY_SERVER_FIELDS:
                root.set(key, str(value))

    _create_backup(xml_path)

    _indent_xml(root)
    tree.write(xml_path, encoding='utf-8', xml_declaration=True)


# ── 备份管理 ─────────────────────────────────────────────────

BACKUP_DIR_NAME = '.baro_backups'


def _get_backup_dir(xml_path: str) -> str:
    """备份目录：在原文件同目录下建 .baro_backups/"""
    base_dir = os.path.dirname(os.path.abspath(xml_path))
    backup_dir = os.path.join(base_dir, BACKUP_DIR_NAME)
    os.makedirs(backup_dir, exist_ok=True)
    return backup_dir


def _create_backup(xml_path: str) -> str:
    """创建时间戳备份，返回备份文件路径"""
    if not os.path.isfile(xml_path):
        raise FileNotFoundError(f'文件不存在: {xml_path}')
    backup_dir = _get_backup_dir(xml_path)
    basename = os.path.basename(xml_path)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:22]  # 含毫秒防重名
    backup_name = f'{basename}.{timestamp}.bak'
    backup_path = os.path.join(backup_dir, backup_name)
    shutil.copy2(xml_path, backup_path)
    return backup_path


def list_backups(xml_path: str) -> list[dict]:
    """列出该文件的所有备份，按时间倒序"""
    backup_dir = _get_backup_dir(xml_path)
    basename = os.path.basename(xml_path)
    pattern = os.path.join(backup_dir, f'{basename}.*.bak')
    files = glob.glob(pattern)
    result = []
    for fp in sorted(files, key=os.path.getmtime, reverse=True):
        fname = os.path.basename(fp)
        # 从文件名解析时间戳
        ts_str = fname.replace(f'{basename}.', '').replace('.bak', '')
        display_time = ts_str
        try:
            # 优先解析带毫秒的格式
            dt = datetime.strptime(ts_str[:15], '%Y%m%d_%H%M%S')
            ms = ''
            if len(ts_str) > 16:
                ms = f'.{ts_str[16:]}'
            display_time = dt.strftime('%Y-%m-%d %H:%M:%S') + ms
        except ValueError:
            pass
        result.append({
            'name': fname,
            'time': display_time,
            'size': os.path.getsize(fp),
            'path': fp,
        })
    return result


def restore_backup(xml_path: str, backup_name: str) -> str:
    """从备份恢复文件，先备份当前文件再覆盖"""
    backup_dir = _get_backup_dir(xml_path)
    backup_path = os.path.join(backup_dir, backup_name)
    if not os.path.isfile(backup_path):
        raise FileNotFoundError(f'备份文件不存在: {backup_path}')
    # 恢复前先备份当前文件
    _create_backup(xml_path)
    shutil.copy2(backup_path, xml_path)
    return backup_name


# ── 工具函数 ───────────────────────────────────────────────── ──────────────────────────────────────────────────

def _indent_xml(elem, level=0):
    """给 ElementTree 输出加缩进（ET 默认不缩进）"""
    indent = '  '
    i = '\n' + level * indent
    if len(elem):
        if not elem.text or not elem.text.strip():
            elem.text = i + indent
        if not elem.tail or not elem.tail.strip():
            elem.tail = i
        for child in elem:
            _indent_xml(child, level + 1)
        if not child.tail or not child.tail.strip():
            child.tail = i
    else:
        if level and (not elem.tail or not elem.tail.strip()):
            elem.tail = i
