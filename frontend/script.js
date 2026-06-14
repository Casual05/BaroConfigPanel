/* ── 状态 ── */
let mods = [];
let currentTab = 'mods';
let fieldInfo = null;

/* ── pywebview 桥接 ── */

/**
 * 等待 pywebview 全局就绪，返回 pywebview 对象
 * 在 pywebview 窗口内自动注入，普通浏览器返回 null
 */
function getPywebview() {
  return new Promise((resolve) => {
    if (window.pywebview) {
      resolve(window.pywebview);
      return;
    }
    // pywebview 注入需要时间，轮询等待
    const timer = setInterval(() => {
      if (window.pywebview) {
        clearInterval(timer);
        resolve(window.pywebview);
      }
    }, 100);
    // 5 秒超时 —— 不在 pywebview 环境就不等了
    setTimeout(() => {
      clearInterval(timer);
      resolve(null);
    }, 5000);
  });
}

/** 安全调用 pywebview API，非 pywebview 环境自动降级返回默认值 */
async function pvApi(method, ...args) {
  const pv = window.pywebview || await getPywebview();
  if (!pv || !pv.api || !pv.api[method]) {
    console.warn(`[pvApi] ${method} 不可用（非 pywebview 环境）`);
    return null;
  }
  return pv.api[method](...args);
}

/* ── 初始化 ── */
document.addEventListener('DOMContentLoaded', async () => {
  // 1. 预加载字段元信息
  fieldInfo = await pvApi('get_field_info');

  // 2. 自动检测当前目录下的配置文件 → 自动加载
  const detected = await pvApi('get_detected_files');
  if (detected) {
    if (detected.config) {
      updateFileStatus('config', detected.config);
      await loadCurrentMods();
    }
    if (detected.server) {
      updateFileStatus('server', detected.server);
      await loadServerSettings();
    }
  }

  // 3. 全窗口拖入识别
  initDragDrop();
});

/* ── 全窗口拖入识别 ── */
function initDragDrop() {
  let dragCounter = 0;
  const overlay = document.getElementById('drag-overlay');

  document.body.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    overlay?.classList.add('active');
  });

  document.body.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  document.body.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      overlay?.classList.remove('active');
    }
  });

  document.body.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    overlay?.classList.remove('active');

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const name = file.name.toLowerCase();

    // 用 FileReader 读取文件内容
    const content = await readFileContent(file);
    if (content === null) {
      showToast('读取文件失败', 'error');
      return;
    }

    if (name === 'config_player.xml') {
      const result = await pvApi('save_dropped_file', 'config', content, file.name);
      if (result?.ok) {
        updateFileStatus('config', result.path);
        showToast('已识别 config_player.xml', 'success');
        await loadCurrentMods();
        switchTab('mods');
      } else {
        showToast('识别失败: ' + (result?.error || '未知错误'), 'error');
      }
    } else if (name === 'serversettings.xml') {
      const result = await pvApi('save_dropped_file', 'server', content, file.name);
      if (result?.ok) {
        updateFileStatus('server', result.path);
        showToast('已识别 serversettings.xml', 'success');
        await loadServerSettings();
        switchTab('server');
      } else {
        showToast('识别失败: ' + (result?.error || '未知错误'), 'error');
      }
    } else if (name.endsWith('.xml')) {
      // 其他 xml → 模组清单，直接传内容解析
      const imported = await pvApi('import_modlist_from_content', content, file.name);
      if (imported && imported.length > 0) {
        mods = imported.filter(m => m.workshop_id !== null);
        renderModList();
        showToast(`已导入模组清单: ${file.name} (${mods.length} 个模组)`, 'success');
        switchTab('mods');
      } else {
        showToast('未能识别为有效模组清单', 'error');
      }
    } else {
      showToast('不支持的文件类型，请拖入 XML 文件', 'error');
    }
  });

/**
 * 用 FileReader 读取文件内容为文本
 */
function readFileContent(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}
}

/* ── 标签切换 ── */
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tab}"]`)?.classList.add('active');
  document.getElementById(`tab-${tab}`)?.classList.add('active');
}

/* ── Toast 通知 ── */
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* ── 文件状态更新 ── */
function updateFileStatus(type, path) {
  const id = type === 'config' ? 'config-status' : 'server-status';
  const pathId = type === 'config' ? 'config-path' : 'server-path';
  const el = document.getElementById(id);
  const pathEl = document.getElementById(pathId);
  const dot = el.querySelector('.status-dot');
  if (path && path !== '未选择') {
    dot.className = 'status-dot online';
    pathEl.textContent = path.split('\\').pop() || path.split('/').pop();
    pathEl.title = path;
  }
}

/* ════════════════════════════════════════════════
   模组面板
   ════════════════════════════════════════════════ */

async function selectConfig() {
  try {
    const path = await pvApi('select_config_file');
    if (path) {
      updateFileStatus('config', path);
      showToast('已选择 config_player.xml', 'success');
    }
  } catch (e) {
    showToast('选择文件失败: ' + e, 'error');
  }
}

async function selectServer() {
  try {
    const path = await pvApi('select_server_file');
    if (path) {
      updateFileStatus('server', path);
      showToast('已选择 serversettings.xml', 'success');
    }
  } catch (e) {
    showToast('选择文件失败: ' + e, 'error');
  }
}

async function importModlist() {
  try {
    const path = await pvApi('select_import_file');
    if (!path) return;

    const imported = await pvApi('import_modlist', path);
    // 过滤掉 Vanilla（corepackage 单独处理）
    mods = imported.filter(m => m.workshop_id !== null);
    renderModList();
    showToast(`成功导入 ${mods.length} 个模组`, 'success');
  } catch (e) {
    showToast('导入失败: ' + e, 'error');
  }
}

async function loadCurrentMods() {
  try {
    const data = await pvApi('load_config');
    if (data.error) {
      showToast(data.error, 'error');
      return;
    }
    if (data.mods) {
      mods = data.mods;
      renderModList();
      showToast(`已读取 ${mods.length} 个模组`, 'success');
    }
  } catch (e) {
    showToast('读取失败: ' + e, 'error');
  }
}

async function saveConfig() {
  try {
    // 收集当前 UI 状态
    const items = document.querySelectorAll('.mod-item');
    const updated = [];
    items.forEach(item => {
      const wid = item.dataset.id;
      const name = item.dataset.name;
      const enabled = item.querySelector('.mod-toggle input').checked;
      updated.push({ workshop_id: wid, name, enabled });
    });
    mods = updated;

    await pvApi('save_config', mods);
    showToast('config_player.xml 保存成功！', 'success');
  } catch (e) {
    showToast('保存失败: ' + e, 'error');
  }
}

function renderModList() {
  const container = document.getElementById('mod-list');
  const countEl = document.getElementById('mod-count');
  if (!mods || mods.length === 0) {
    container.innerHTML = '<div class="mod-list-empty">暂无模组，请导入或读取配置</div>';
    countEl.textContent = '模组数量: 0';
    return;
  }

  container.innerHTML = '';
  mods.forEach((m, idx) => {
    const item = document.createElement('div');
    item.className = 'mod-item';
    item.draggable = true;
    item.dataset.id = m.workshop_id || '';
    item.dataset.name = m.name || '';

    item.innerHTML = `
      <div class="mod-drag-handle">⋮⋮</div>
      <div class="mod-toggle">
        <input type="checkbox" ${m.enabled !== false ? 'checked' : ''}>
      </div>
      <div class="mod-name-text">${escHtml(m.name || '')}</div>
      <div class="mod-id-text">${escHtml(m.workshop_id || '')}</div>
    `;

    // 拖拽事件
    item.addEventListener('dragstart', onDragStart);
    item.addEventListener('dragend', onDragEnd);
    item.addEventListener('dragover', onDragOver);
    item.addEventListener('dragleave', onDragLeave);
    item.addEventListener('drop', onDrop);

    container.appendChild(item);
  });

  countEl.textContent = `模组数量: ${mods.length}`;
}

/* ── 拖拽排序 ── */
let dragSrcIndex = null;

function onDragStart(e) {
  this.classList.add('dragging');
  dragSrcIndex = Array.from(this.parentNode.children).indexOf(this);
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
}

function onDragEnd() {
  this.classList.remove('dragging');
  document.querySelectorAll('.mod-item').forEach(el => el.classList.remove('drag-over'));
  dragSrcIndex = null;
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const items = this.parentNode.children;
  const src = items[dragSrcIndex];
  if (src && src !== this) {
    // 决定插入位置
    const rect = this.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      this.parentNode.insertBefore(src, this);
    } else {
      this.parentNode.insertBefore(src, this.nextSibling);
    }
  }
  this.classList.add('drag-over');
}

function onDragLeave() {
  this.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over');
  // 重新读取排序后的 mods
  const items = document.querySelectorAll('.mod-item');
  const reordered = [];
  items.forEach(item => {
    const wid = item.dataset.id;
    const name = item.dataset.name;
    const enabled = item.querySelector('.mod-toggle input').checked;
    reordered.push({ workshop_id: wid, name, enabled });
  });
  mods = reordered;
}


/* ════════════════════════════════════════════════
   服务器设置面板
   ════════════════════════════════════════════════ */

const FIELD_GROUPS = {
  '基础设置': ['ServerName', 'ServerMessageText', 'password', 'port', 'queryport', 'MaxPlayers', 'IsPublic', 'Language'],
  '性能与Tick': ['TickRate', 'MaxLagCompensation', 'BotCount', 'MaxBotCount'],
  '超时与同步': ['TimeoutThresholdInGame', 'TimeoutThresholdNotInGame', 'KillDisconnectedTime', 'KickAFKTime',
                 'VoteTimeout', 'MinimumMidRoundSyncTimeout', 'RoundStartSyncDuration',
                 'EventRemovalTime', 'OldReceivedEventKickTime', 'OldEventKickTime',
                 'DespawnDisconnectedPermadeathTime'],
  '游戏规则': ['AllowFriendlyFire', 'RespawnMode', 'RespawnInterval', 'TraitorProbability',
              'TraitorsMinPlayerCount', 'KarmaEnabled', 'IronmanMode',
              'GameModeIdentifier', 'SelectedSubmarine', 'ModeSelectionMode', 'SubSelectionMode',
              'PlayStyle', 'LosMode', 'ShowEnemyHealthBars'],
  '投票与踢出': ['AllowVoteKick', 'VoteRequiredRatio', 'KickVoteRequiredRatio',
                'EndVoteRequiredRatio', 'AllowEndVoting', 'KickAFKTime'],
  '杂项': ['AllowSpectating', 'VoiceChatEnabled', 'AllowModDownloads', 'AllowFileTransfers',
           'AllowRemoteCampaignInteractions', 'AutoRestart', 'AutoRestartInterval',
           'ServerMessageText'],
};

const FIELD_LABELS = {
  'ServerName': '服务器名称',
  'ServerMessageText': '服务器公告',
  'password': '密码',
  'port': '端口',
  'queryport': '查询端口',
  'MaxPlayers': '最大玩家数',
  'IsPublic': '公开服务器',
  'Language': '语言',
  'TickRate': '服务器刷新率 (tick/s)',
  'MaxLagCompensation': '最大延迟补偿 (ms)',
  'BotCount': 'Bot 数量',
  'MaxBotCount': '最大 Bot 数',
  'TimeoutThresholdInGame': '游戏中无响应超时 (s)',
  'TimeoutThresholdNotInGame': '未进游戏超时 (s)',
  'KillDisconnectedTime': '断线角色保留时间 (ms)',
  'KickAFKTime': '挂机踢出时间 (ms)',
  'VoteTimeout': '投票超时 (s)',
  'MinimumMidRoundSyncTimeout': '局中最小同步超时 (s)',
  'RoundStartSyncDuration': '回合开始同步时间 (s)',
  'EventRemovalTime': '事件移除时间 (s)',
  'OldReceivedEventKickTime': '旧接收事件踢出 (s)',
  'OldEventKickTime': '旧事件踢出 (s)',
  'DespawnDisconnectedPermadeathTime': '永久死亡断线销毁 (s)',
  'AllowFriendlyFire': '允许友伤',
  'AllowVoteKick': '允许投票踢人',
  'AllowEndVoting': '允许结束投票',
  'AllowSpectating': '允许旁观',
  'AllowModDownloads': '允许模组下载',
  'AllowFileTransfers': '允许文件传输',
  'AllowRemoteCampaignInteractions': '允许远程战役交互',
  'VoiceChatEnabled': '启用语音',
  'RespawnMode': '重生模式',
  'RespawnInterval': '重生间隔 (s)',
  'TraitorProbability': '叛徒概率',
  'TraitorsMinPlayerCount': '叛徒最少玩家数',
  'KarmaEnabled': '启用 Karma',
  'IronmanMode': '铁人模式',
  'AutoRestart': '自动重启',
  'AutoRestartInterval': '自动重启间隔 (min)',
  'GameModeIdentifier': '游戏模式',
  'SelectedSubmarine': '选择潜艇',
  'ModeSelectionMode': '模式选择方式',
  'SubSelectionMode': '潜艇选择方式',
  'PlayStyle': '游戏风格',
  'LosMode': '视野模式',
  'ShowEnemyHealthBars': '敌人体力条',
  'VoteRequiredRatio': '投票通过比例 (%)',
  'KickVoteRequiredRatio': '踢人投票通过比例 (%)',
  'EndVoteRequiredRatio': '结束投票通过比例 (%)',
  'KickAFKTime': '挂机踢出时间 (ms)',
};

/* ── 下拉选项中文标签 ── */
const FIELD_OPTION_LABELS = {
  'Language':           { 'Chinese': '中文', 'English': 'English' },
  'RespawnMode':        { 'MidRound': '局中重生', 'BetweenRounds': '回合间重生', 'NoRespawn': '无重生' },
  'PlayStyle':          { 'Serious': '严肃', 'Casual': '休闲', 'Rampage': '狂暴', 'Roleplay': '角色扮演', 'SomethingDifferent': '其他' },
  'LosMode':            { 'Transparent': '透明', 'Opaque': '不透明', 'None': '无' },
  'ShowEnemyHealthBars': { 'ShowAll': '全部显示', 'ShowOnlyWithSonar': '仅声纳显示', 'Hidden': '隐藏' },
  'GameModeIdentifier':  { 'multiplayercampaign': '多人战役', 'sandbox': '沙盒', 'pvp': 'PvP' },
  'ModeSelectionMode':   { 'Manual': '手动', 'Random': '随机', 'Vote': '投票' },
  'SubSelectionMode':    { 'Manual': '手动', 'Random': '随机', 'Vote': '投票', 'Faction': '派系' },
};

/** 获取选项的显示标签（找不到就用原值） */
function getOptionLabel(field, value) {
  return FIELD_OPTION_LABELS[field]?.[value] || value;
}

async function loadServerSettings() {
  try {
    const data = await pvApi('load_serversettings');
    if (data.error) {
      showToast(data.error, 'error');
      return;
    }
    renderServerForm(data);
    showToast('已读取服务器设置', 'success');
  } catch (e) {
    showToast('读取失败: ' + e, 'error');
  }
}

function renderServerForm(data) {
  const form = document.getElementById('server-form');
  form.innerHTML = '';

  for (const [groupName, fields] of Object.entries(FIELD_GROUPS)) {
    const group = document.createElement('div');
    group.className = 'field-group';

    const title = document.createElement('div');
    title.className = 'field-group-title';
    title.textContent = groupName;
    group.appendChild(title);

    for (const field of fields) {
      const rawValue = data[field];
      if (rawValue === undefined) continue;

      const row = document.createElement('div');
      row.className = 'field-row';
      row.dataset.field = field;

      const label = document.createElement('div');
      label.className = 'field-label';
      label.textContent = FIELD_LABELS[field] || field;
      row.appendChild(label);

      const control = document.createElement('div');
      control.className = 'field-control';

      const type = fieldInfo?.type_map[field] || 'text';

      if (type === 'bool') {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = rawValue === 'True' || rawValue === 'true';
        cb.dataset.field = field;
        cb.addEventListener('change', () => collectServerData());
        control.appendChild(cb);
      } else if (type === 'select') {
        const sel = document.createElement('select');
        sel.dataset.field = field;
        const options = fieldInfo?.select_options[field] || [];
        options.forEach(opt => {
          const op = document.createElement('option');
          op.value = opt;
          op.textContent = getOptionLabel(field, opt);
          if (opt === rawValue) op.selected = true;
          sel.appendChild(op);
        });
        sel.addEventListener('change', () => collectServerData());
        control.appendChild(sel);
      } else if (type === 'percentage') {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = '0';
        inp.max = '100';
        inp.step = '1';
        inp.dataset.field = field;
        inp.value = (parseFloat(rawValue) * 100).toFixed(0);
        inp.addEventListener('input', () => collectServerData());
        control.appendChild(inp);
        const suffix = document.createElement('span');
        suffix.style.cssText = 'margin-left:4px;color:var(--text-dim);font-size:13px;';
        suffix.textContent = '%';
        control.appendChild(suffix);
      } else if (type === 'textarea' || field === 'ServerMessageText') {
        const ta = document.createElement('textarea');
        ta.dataset.field = field;
        ta.value = rawValue;
        ta.addEventListener('input', () => collectServerData());
        control.appendChild(ta);
      } else if (type === 'float') {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = '0.01';
        inp.dataset.field = field;
        inp.value = rawValue;
        inp.addEventListener('input', () => collectServerData());
        control.appendChild(inp);
      } else {
        const inp = document.createElement('input');
        inp.type = type === 'number' ? 'number' : 'text';
        inp.dataset.field = field;
        inp.value = rawValue;
        inp.addEventListener('input', () => collectServerData());
        control.appendChild(inp);
      }

      row.appendChild(control);
      group.appendChild(row);
    }

    form.appendChild(group);
  }
}

let serverDataCache = {};

function collectServerData() {
  serverDataCache = {};
  document.querySelectorAll('.field-row').forEach(row => {
    const field = row.dataset.field;
    const control = row.querySelector('.field-control');
    if (!control || !field) return;

    const input = control.querySelector('input, select, textarea');
    if (!input) return;

    let val;
    if (input.type === 'checkbox') {
      val = input.checked ? 'True' : 'False';
    } else {
      val = input.value;
    }

    // 百分比字段：用户输入 0-100，存回 0-1
    const type = fieldInfo?.type_map?.[field];
    if (type === 'percentage') {
      const num = parseFloat(val);
      val = isNaN(num) ? '0' : (num / 100).toFixed(2);
    }

    serverDataCache[field] = val;
  });
  return serverDataCache;
}

async function saveServerSettings() {
  try {
    const data = collectServerData();
    if (Object.keys(data).length === 0) {
      showToast('没有数据可保存', 'error');
      return;
    }
    await pvApi('save_serversettings', data);
    showToast('serversettings.xml 保存成功！', 'success');
  } catch (e) {
    showToast('保存失败: ' + e, 'error');
  }
}

/* ════════════════════════════════════════════════
   备份管理
   ════════════════════════════════════════════════ */

async function openBackupManager() {
  const modal = document.getElementById('backup-modal');
  modal.classList.add('active');

  // 加载 config 备份
  const configList = document.getElementById('backup-list-config');
  configList.innerHTML = '<div class="backup-empty">加载中...</div>';
  try {
    const configBackups = await pvApi('list_backups', 'config');
    renderBackupList(configList, configBackups, 'config');
  } catch {
    configList.innerHTML = '<div class="backup-empty">请先选择 config_player.xml</div>';
  }

  // 加载 server 备份
  const serverList = document.getElementById('backup-list-server');
  serverList.innerHTML = '<div class="backup-empty">加载中...</div>';
  try {
    const serverBackups = await pvApi('list_backups', 'server');
    renderBackupList(serverList, serverBackups, 'server');
  } catch {
    serverList.innerHTML = '<div class="backup-empty">请先选择 serversettings.xml</div>';
  }
}

function renderBackupList(container, backups, fileType) {
  if (!backups || backups.length === 0) {
    container.innerHTML = '<div class="backup-empty">暂无备份</div>';
    return;
  }
  container.innerHTML = '';
  backups.forEach(b => {
    const item = document.createElement('div');
    item.className = 'backup-item';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'backup-time';
    timeSpan.textContent = b.time;
    item.appendChild(timeSpan);

    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'backup-size';
    sizeSpan.textContent = formatSize(b.size);
    item.appendChild(sizeSpan);

    const restoreSpan = document.createElement('span');
    restoreSpan.className = 'backup-restore';
    const btn = document.createElement('button');
    btn.className = 'btn-restore';
    btn.textContent = '↩ 恢复';
    btn.onclick = async () => {
      if (confirm(`确定要从 ${b.time} 的备份恢复吗？\n当前文件会自动备份。`)) {
        btn.disabled = true;
        btn.textContent = '恢复中...';
        try {
          await pvApi('restore_backup', fileType, b.name);
          showToast('恢复成功！当前文件已备份', 'success');
          // 刷新备份列表
          openBackupManager();
        } catch (e) {
          showToast('恢复失败: ' + e, 'error');
          btn.disabled = false;
          btn.textContent = '↩ 恢复';
        }
      }
    };
    restoreSpan.appendChild(btn);
    item.appendChild(restoreSpan);

    container.appendChild(item);
  });
}

function closeBackupManager(event) {
  if (event && event.target !== document.getElementById('backup-modal')) return;
  document.getElementById('backup-modal').classList.remove('active');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

/* ── 工具 ── */
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
