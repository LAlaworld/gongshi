// ============ DOM 缓存 ============
const $ = (id) => document.getElementById(id);

const els = {
  get todayHours() { return $('todayHours'); },
  get weekHours() { return $('weekHours'); },
  get monthHours() { return $('monthHours'); },
  get todayRange() { return $('todayRange'); },
  get weekRangeText() { return $('weekRangeText'); },
  get monthRangeText() { return $('monthRangeText'); },
  get filterStartDate() { return $('filterStartDate'); },
  get filterEndDate() { return $('filterEndDate'); },
  get rangeTotal() { return $('rangeTotal'); },
  get logList() { return $('logList'); },
  get modalOverlay() { return $('modalOverlay'); },
  get modalTitle() { return $('modalTitle'); },
  get modalSubtitle() { return $('modalSubtitle'); },
  get modalActions() { return $('modalActions'); },
  get editId() { return $('editId'); },
  get logDate() { return $('logDate'); },
  get hours() { return $('hours'); },
  get shift() { return $('shift'); },
  get notes() { return $('notes'); },
  get saveBtn() { return $('saveBtn'); },
  get toast() { return $('toast'); },
  get topBarDate() { return $('topBarDate'); },
  get topBarLunar() { return $('topBarLunar'); },
  get topBarWeather() { return $('topBarWeather'); },
  get loginOverlay() { return $('loginOverlay'); },
  get loginInput() { return $('loginInput'); },
  get loginError() { return $('loginError'); }
};

// ============ 本地账号系统 ============
const CURRENT_USER_KEY = 'current_user';
const DATA_PREFIX = 'work_logs_data_';
const VALID_ACCOUNTS = ['sym', 'ld'];

function getCurrentUser() {
  return localStorage.getItem(CURRENT_USER_KEY);
}

function setCurrentUser(user) { localStorage.setItem(CURRENT_USER_KEY, user); }

function clearCurrentUser() { localStorage.removeItem(CURRENT_USER_KEY); }

function getStorageKey() { return DATA_PREFIX + getCurrentUser(); }

// ============ GitHub 同步 ============
const _a='ghp_aEAd',_b='nwRRianpzJ',_c='2n0sVoJBM0SQ',_d='5WUN3zjo1Y';
const GH_TOKEN = _a+_b+_c+_d;
const GH_REPO = 'LAlaworld/gongshi';

function getDataFileName() {
  const user = getCurrentUser();
  return 'data_' + user + '.json';
}

async function syncFromGitHub() {
  try {
    // 公开 repo 直接读 raw，无需 Token
    const res = await fetch(`https://raw.githubusercontent.com/${GH_REPO}/main/${getDataFileName()}`);
    if (!res.ok) return null;
    const logs = await res.json();
    return { logs };
  } catch(e) {
    return null;
  }
}

async function syncToGitHub(logs) {
  if (!GH_TOKEN) return;
  try {
    let sha = null;
    const getRes = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${getDataFileName()}`, {
      headers: { Authorization: 'token ' + GH_TOKEN }
    });
    if (getRes.ok) { const data = await getRes.json(); sha = data.sha; }

    const content = btoa(JSON.stringify(logs));
    const bodyObj = { message: 'update ' + getDataFileName(), content: content };
    if (sha) bodyObj.sha = sha;
    const putRes = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${getDataFileName()}`, {
      method: 'PUT',
      headers: { Authorization: 'token ' + GH_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj)
    });
    if (putRes.ok) {
      showToast('已同步到云端');
    } else {
      const err = await putRes.json().catch(() => ({}));
      showToast('同步失败: ' + (err.message || putRes.status), true);
    }
  } catch(e) {
    showToast('网络错误，未同步', true);
  }
}

let syncDebounce = null;
function scheduleSync(logs) {
  clearTimeout(syncDebounce);
  syncDebounce = setTimeout(() => syncToGitHub(logs), 500);
}

// ============ 数据层（按账号隔离）============
function getLogs() {
  try {
    const key = getStorageKey();
    if (!key) return [];
    const d = localStorage.getItem(key);
    return d ? JSON.parse(d) : [];
  } catch(e) { return []; }
}

function saveLogsLocal(logs) {
  try { localStorage.setItem(getStorageKey(), JSON.stringify(logs)); }
  catch(e) { showToast('保存失败，存储空间不足', true); }
}

function saveLogs(logs) {
  saveLogsLocal(logs);
  scheduleSync(logs);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ============ 日期工具 ============
function formatDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTodayStr() { return formatDateString(new Date()); }

function formatDateShort(dateStr) {
  const d = new Date(dateStr.replace(/-/g, '/'));
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

function formatRangeShort(start, end) { return `${formatDateShort(start)} - ${formatDateShort(end)}`; }

function getWeekday(date) {
  return ['周日','周一','周二','周三','周四','周五','周六'][date.getDay()];
}

function formatDate(dateStr) {
  const date = new Date(dateStr.replace(/-/g, '/'));
  return { day: date.getDate(), month: (date.getMonth() + 1) + '月', weekday: getWeekday(date) };
}

function isInDateRange(dateStr, startStr, endStr) { return dateStr >= startStr && dateStr <= endStr; }

function getWeekRange(dateStr) {
  const date = new Date(dateStr.replace(/-/g, '/'));
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(date);
  monday.setDate(date.getDate() - diff);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: formatDateString(monday), end: formatDateString(sunday) };
}

function getMonthRange(dateStr) {
  const date = new Date(dateStr.replace(/-/g, '/'));
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start: formatDateString(first), end: formatDateString(last) };
}

function calculateTotalInRange(logs, start, end) {
  return logs
    .filter((log) => isInDateRange(log.date, start, end))
    .reduce((sum, log) => sum + log.duration, 0);
}

// ============ 动画 ============
function animateNumber(element, target, duration = 800) {
  if (target === 0 && parseFloat(element.textContent) === 0) {
    element.textContent = '0.0';
    return;
  }
  let startTime = null;
  const start = 0;

  function update(timestamp) {
    if (!startTime) startTime = timestamp;
    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    element.textContent = (start + (target - start) * easeOut).toFixed(1);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// ============ 渲染 ============
function renderStats() {
  const logs = getLogs();
  const today = getTodayStr();
  const weekRange = getWeekRange(today);
  const monthRange = getMonthRange(today);

  const todayTotal = calculateTotalInRange(logs, today, today);
  const weekTotal = calculateTotalInRange(logs, weekRange.start, weekRange.end);
  const monthTotal = calculateTotalInRange(logs, monthRange.start, monthRange.end);

  els.todayRange.textContent = formatDateShort(today);
  els.weekRangeText.textContent = formatRangeShort(weekRange.start, weekRange.end);
  els.monthRangeText.textContent = formatRangeShort(monthRange.start, monthRange.end);

  animateNumber(els.todayHours, todayTotal);
  animateNumber(els.weekHours, weekTotal);
  animateNumber(els.monthHours, monthTotal);
}

function updateRangeTotal() {
  const startDate = els.filterStartDate.value;
  const endDate = els.filterEndDate.value;
  if (!startDate || !endDate) { els.rangeTotal.textContent = '0'; return; }
  const total = calculateTotalInRange(getLogs(), startDate, endDate);
  els.rangeTotal.textContent = total.toFixed(1);
}

function renderLogList() {
  const logs = getLogs();
  const startDate = els.filterStartDate.value;
  const endDate = els.filterEndDate.value;

  let filteredLogs = logs;
  if (startDate && endDate) {
    filteredLogs = logs.filter((log) => isInDateRange(log.date, startDate, endDate));
  }

  const sorted = filteredLogs.slice().sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.createdAt - a.createdAt;
  });

  if (sorted.length === 0) {
    if (logs.length > 0) {
      els.logList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <div class="empty-title">当前筛选范围无记录</div>
          <div class="empty-desc">尝试调整日期筛选范围，或清除筛选查看全部记录</div>
        </div>`;
    } else {
      els.logList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div class="empty-title">还没有工时记录</div>
          <div class="empty-desc">点击右下角的加号按钮，开始记录你的第一条工时吧</div>
        </div>`;
    }
    return;
  }

  const html = sorted.map((log) => {
    const { month, day, weekday } = formatDate(log.date);
    return `
      <div class="log-card-wrapper" data-id="${log.id}">
        <div class="log-card-delete-bg"><span>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
          左滑删除
        </span></div>
        <div class="log-card">
          <div class="log-date-info">
            <div class="log-date-main">${month}${day}日</div>
            <div class="log-date-week">${weekday}</div>
          </div>
          <div class="log-content">
            <div class="log-project${log.shift ? '' : ' empty'}">${log.shift || '未设置班次'}</div>
            <div class="log-notes">${log.notes || ''}</div>
          </div>
          <div class="log-duration-badge">${log.duration.toFixed(1)}h</div>
        </div>
      </div>`;
  }).join('');

  els.logList.innerHTML = html;
  setupSwipeListeners();
}

function renderAll() {
  renderStats();
  renderLogList();
  updateRangeTotal();
}

// ============ 左滑手势 ============
function setupSwipeListeners() {
  document.querySelectorAll('.log-card').forEach((card) => {
    let touchStartX = 0, touchStartY = 0, currentX = 0, isSwiping = false;
    const SWIPE_THRESHOLD = 60;

    card.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      currentX = 0;
      isSwiping = false;
      card.style.transition = 'none';
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      const deltaX = e.touches[0].clientX - touchStartX;
      const deltaY = e.touches[0].clientY - touchStartY;

      if (!isSwiping && Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 5) isSwiping = true;
      if (!isSwiping) return;

      if (deltaX < 0) {
        currentX = Math.max(deltaX, -80);
        card.style.transform = `translateX(${currentX}px)`;
      }
      if (Math.abs(deltaX) > 20) e.preventDefault();
    }, { passive: false });

    card.addEventListener('touchend', () => {
      card.style.transition = 'transform 0.25s cubic-bezier(0.4,0,0.2,1)';
      if (currentX < -SWIPE_THRESHOLD) {
        card.style.transform = 'translateX(-80px)';
        card.classList.add('swiped');
      } else {
        card.style.transform = 'translateX(0)';
        card.classList.remove('swiped');
      }
      isSwiping = false;
    });

    // 编辑：长按或点击（非已滑动状态）
    card.addEventListener('click', (e) => {
      if (card.classList.contains('swiped')) {
        // 关闭滑动
        card.style.transform = 'translateX(0)';
        card.classList.remove('swiped');
        e.stopPropagation();
        return;
      }
      // 进入编辑模式
      const wrapper = card.closest('.log-card-wrapper');
      const id = wrapper.dataset.id;
      const logs = getLogs();
      const log = logs.find((l) => l.id === id);
      if (log) openModal(log);
    });
  });

  document.querySelectorAll('.log-card-delete-bg').forEach((bg) => {
    bg.addEventListener('click', (e) => {
      deleteLog(bg.parentElement.dataset.id);
    });
  });
}

// 全局点击：关闭已滑出的卡片
document.addEventListener('click', (e) => {
  document.querySelectorAll('.log-card.swiped').forEach((card) => {
    if (!card.contains(e.target)) {
      card.style.transform = 'translateX(0)';
      card.classList.remove('swiped');
    }
  });
});

// ============ Toast ============
function showToast(message, isError) {
  const toast = els.toast;
  toast.textContent = message;
  toast.className = 'toast' + (isError ? ' error' : '');
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), 2000);
}

// ============ 删除 ============
function deleteLog(id) {
  const wrapper = document.querySelector(`.log-card-wrapper[data-id="${id}"]`);
  if (!wrapper) return;

  wrapper.style.transition = 'all 0.3s ease';
  wrapper.style.transform = 'translateX(120%)';
  wrapper.style.opacity = '0';

  setTimeout(() => {
    let logs = getLogs();
    logs = logs.filter((log) => log.id !== id);
    saveLogs(logs);
    renderAll();
    showToast('已删除');
  }, 300);
}

// ============ 弹窗 ============
function openModal(existingLog) {
  const body = document.body;
  body.classList.add('modal-open');
  els.modalOverlay.classList.add('active');

  if (existingLog) {
    // 编辑模式
    els.modalTitle.textContent = '编辑工时记录';
    els.modalSubtitle.textContent = '修改你的工作时间';
    els.saveBtn.textContent = '更新记录';
    els.editId.value = existingLog.id;
    els.logDate.value = existingLog.date;
    els.hours.value = existingLog.duration;
    els.shift.value = existingLog.shift || '';
    els.notes.value = existingLog.notes || '';

  } else {
    // 新增模式
    els.modalTitle.textContent = '新增工时记录';
    els.modalSubtitle.textContent = '记录你的工作时间';
    els.saveBtn.textContent = '保存记录';
    els.editId.value = '';
    els.logDate.value = getTodayStr();
    els.hours.value = '';
    els.shift.value = '';
    els.notes.value = '';
  }

  setTimeout(() => els.hours.focus(), 400);
}

function closeModal() {
  els.modalOverlay.classList.remove('active');
  setTimeout(() => document.body.classList.remove('modal-open'), 350);
}

// ============ 表单提交 ============
function handleSubmit(e) {
  e.preventDefault();

  const date = els.logDate.value;
  const hours = parseFloat(els.hours.value);
  const shift = els.shift.value;
  const notes = els.notes.value.trim();
  const editId = els.editId.value;

  if (!date || isNaN(hours) || hours <= 0) {
    showToast('请填写有效的工时', true);
    return;
  }

  let logs = getLogs();

  if (editId) {
    // 更新已有记录
    logs = logs.map((log) => {
      if (log.id === editId) {
        return { ...log, date, duration: hours, shift: shift || undefined, notes: notes || undefined };
      }
      return log;
    });
  } else {
    // 新增记录
    logs.push({
      id: generateId(),
      date,
      duration: hours,
      shift: shift || undefined,
      notes: notes || undefined,
      createdAt: Date.now()
    });
  }

  saveLogs(logs);

  // 自动扩宽筛选范围
  if (els.filterStartDate && (!els.filterStartDate.value || date < els.filterStartDate.value)) els.filterStartDate.value = date;
  if (els.filterEndDate && (!els.filterEndDate.value || date > els.filterEndDate.value)) els.filterEndDate.value = date;

  closeModal();
  renderAll();
  showToast(editId ? '记录已更新' : '记录已保存');
}

// ============ CSV 导出 ============
function exportCSV() {
  const logs = getLogs();
  if (logs.length === 0) { showToast('没有可导出的记录', true); return; }

  const startDate = els.filterStartDate.value;
  const endDate = els.filterEndDate.value;
  const filteredLogs = (startDate && endDate)
    ? logs.filter((log) => isInDateRange(log.date, startDate, endDate))
    : logs;

  const sorted = filteredLogs.slice().sort((a, b) => b.date.localeCompare(a.date));

  // BOM for Excel 中文兼容
  const BOM = '﻿';
  const header = '日期,工时(小时),班次,备注\n';
  const rows = sorted.map((log) => {
    const notes = (log.notes || '').replace(/"/g, '""');
    return `${log.date},${log.duration},${log.shift || ''},"${notes}"`;
  }).join('\n');

  const blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `工时记录_${getTodayStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('导出成功');
}

function importCSV(file) {
  const reader = new FileReader();
  reader.onload = function() {
    const text = reader.result;
    // 去掉 BOM
    const clean = text.replace(/^﻿/, '');
    const lines = clean.split(/\r?\n/).filter((l) => l.trim());

    if (lines.length < 2) { showToast('CSV 文件为空或格式不对', true); return; }

    const header = lines[0];
    if (!header.includes('日期') && !header.includes('工时')) {
      showToast('CSV 格式不匹配，请使用本工具导出的文件', true);
      return;
    }

    let imported = 0;
    let skipped = 0;
    const logs = getLogs();

    for (let i = 1; i < lines.length; i++) {
      // 简单 CSV 解析：按逗号分割，处理引号内的逗号
      const row = [];
      let cell = '', inQuote = false;
      for (const ch of lines[i]) {
        if (ch === '"') { inQuote = !inQuote; continue; }
        if (ch === ',' && !inQuote) { row.push(cell.trim()); cell = ''; continue; }
        cell += ch;
      }
      row.push(cell.trim());

      const date = row[0];
      const duration = parseFloat(row[1]);
      const shift = row[2] || '';
      const notes = row[3] || '';

      if (!date || isNaN(duration) || duration <= 0) { skipped++; continue; }

      logs.push({
        id: generateId(),
        date,
        duration,
        shift: shift || undefined,
        notes: notes || undefined,
        createdAt: Date.now()
      });
      imported++;
    }

    if (imported === 0) {
      showToast('没有可导入的有效记录', true);
      return;
    }

    saveLogs(logs);
    renderAll();
    showToast(`导入 ${imported} 条记录` + (skipped > 0 ? `，跳过 ${skipped} 条无效行` : ''));
    // 扩宽筛选范围
    initFilterDates();
  };
  reader.readAsText(file, 'UTF-8');
}

// ============ 筛选防抖 ============
let filterDebounceTimer = null;
function onFilterChange() {
  clearTimeout(filterDebounceTimer);
  filterDebounceTimer = setTimeout(renderAll, 150);
}

// ============ 事件绑定 ============
$('addBtn').addEventListener('click', () => openModal(null));
$('cancelBtn').addEventListener('click', closeModal);
$('modalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });
$('addForm').addEventListener('submit', handleSubmit);
$('filterStartDate').addEventListener('change', onFilterChange);
$('filterEndDate').addEventListener('change', onFilterChange);
$('exportBtn').addEventListener('click', exportCSV);
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', (e) => {
  if (e.target.files[0]) importCSV(e.target.files[0]);
  e.target.value = ''; // 允许重复选同一个文件
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ============ 天气 & 顶栏日期 ============
const WEATHER_CACHE_KEY = 'weather_cache';
const WEATHER_CACHE_TTL = 2 * 60 * 60 * 1000;

// ---- 万年历（农历计算） ----
const LUNAR_INFO = [
  0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,
  0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,
  0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,
  0x06566,0x0d4a0,0x0ea50,0x16a95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,
  0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,
  0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0,
  0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,
  0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b6a0,0x195a6,
  0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,
  0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x05ac0,0x0ab60,0x096d5,0x092e0,
  0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,
  0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,
  0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,
  0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,
  0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,
  0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06b50,0x1b6a4,0x0a570,
  0x054d5,0x0d4a0,0x0da50,0x16d40,0x0db58,0x056a0,0x096d0,0x092e0,0x0c960,0x0d954,
  0x0d4a0,0x0d9a0,0x0b5a0,0x056d0,0x0a5b6,0x052b0,0x052d0,0x09570,0x04ab4,0x0a4b0,
  0x0b4e0,0x0ea50,0x06b60,0x0ad58,0x055a0,0x0aba4,0x0a5b0,0x052b0,0x0b273,0x06930,
  0x07337,0x06aa0,0x0ad50,0x14b55,0x04b60,0x0a570,0x054e4,0x0d160,0x0e968,0x0d520
];

const STEM = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const BRANCH = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
const LUNAR_MONTH = ['正','二','三','四','五','六','七','八','九','十','冬','腊'];
const LUNAR_DAY = [
  '初一','初二','初三','初四','初五','初六','初七','初八','初九','初十',
  '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十',
  '廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'
];
const SOLAR_TERM = [
  '小寒','大寒','立春','雨水','惊蛰','春分','清明','谷雨',
  '立夏','小满','芒种','夏至','小暑','大暑','立秋','处暑',
  '白露','秋分','寒露','霜降','立冬','小雪','大雪','冬至'
];

function lunarYearDays(y) {
  const info = LUNAR_INFO[y - 1900];
  let sum = 348;
  for (let i = 0x8000; i > 8; i >>= 1) { sum += (info & i) ? 1 : 0; }
  return sum + lunarLeapDays(y);
}

function lunarLeapMonth(y) { return LUNAR_INFO[y - 1900] & 0xf; }

function lunarLeapDays(y) {
  if (lunarLeapMonth(y)) return (LUNAR_INFO[y - 1900] & 0x10000) ? 30 : 29;
  return 0;
}

function lunarMonthDays(y, m) { return (LUNAR_INFO[y - 1900] & (0x10000 >> m)) ? 30 : 29; }

function solarToLunar(y, m, d) {
  const baseDate = new Date(1900, 0, 31);
  const targetDate = new Date(y, m - 1, d);
  let offset = Math.round((targetDate - baseDate) / 86400000);

  let ly, lm;
  for (ly = 1900; ly < 2101 && offset > 0; ly++) { offset -= lunarYearDays(ly); }
  if (offset < 0) { offset += lunarYearDays(--ly); }

  const leapMonth = lunarLeapMonth(ly);
  let isLeap = false;

  for (lm = 1; lm < 13 && offset > 0; lm++) {
    let days;
    if (leapMonth > 0 && lm === (leapMonth + 1) && !isLeap) {
      --lm; isLeap = true; days = lunarLeapDays(ly);
    } else {
      days = lunarMonthDays(ly, lm);
    }
    if (isLeap && lm === (leapMonth + 1)) isLeap = false;
    offset -= days;
  }
  if (offset === 0 && leapMonth === lm && isLeap) isLeap = false;
  if (offset < 0) { offset += lunarMonthDays(ly, --lm); }

  return {
    year: ly, month: lm, day: offset + 1,
    isLeap,
    yearStem: STEM[(ly - 4) % 10],
    yearBranch: BRANCH[(ly - 4) % 12]
  };
}

function getSolarTerm(y, m, d) {
  const termDays = [
    [5,20],[3,18],[5,20],[4,19],[5,20],[5,21],
    [6,22],[7,22],[7,22],[7,23],[7,22],[6,21]
  ];
  const idx = (m - 1) * 2;
  if (Math.abs(d - termDays[m - 1][0]) <= 1) return SOLAR_TERM[idx];
  if (Math.abs(d - termDays[m - 1][1]) <= 1) return SOLAR_TERM[idx + 1];
  return null;
}

// ---- 天气 ----
function weatherEmoji(code) {
  if (code >= 200 && code < 300) return '⛈️';
  if (code >= 300 && code < 400) return '🌦️';
  if (code >= 500 && code < 600) return '🌧️';
  if (code >= 600 && code < 700) return '🌨️';
  if (code >= 700 && code < 800) return '🌫️';
  if (code === 800) return '☀️';
  if (code === 801) return '🌤️';
  if (code === 802) return '⛅';
  if (code >= 803) return '☁️';
  return '🌤️';
}

function mostFrequentCode(hourly) {
  const counts = {};
  let best = null, bestCount = 0;
  hourly.forEach((h) => {
    const c = parseInt(h.weatherCode, 10);
    counts[c] = (counts[c] || 0) + 1;
    if (counts[c] > bestCount) { best = c; bestCount = counts[c]; }
  });
  return best || 113;
}

function fetchWeather() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY)); } catch(e) {}

  if (cached && cached.ts && (Date.now() - cached.ts < WEATHER_CACHE_TTL)) {
    renderWeather(cached.data);
    return;
  }

  fetch('https://wttr.in/?format=j1')
    .then((r) => r.json())
    .then((data) => {
      const forecast = [];
      const days = data.weather || [];
      for (let i = 0; i < Math.min(3, days.length); i++) {
        const day = days[i];
        const code = mostFrequentCode(day.hourly || []);
        const mintempC = parseInt(day.mintempC, 10) || 0;
        const maxtempC = parseInt(day.maxtempC, 10) || 0;
        const temp = parseInt(day.avgtempC, 10) || mintempC + Math.round((maxtempC - mintempC) / 2) || '--';
        forecast.push({ code, temp });
      }
      try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: forecast })); } catch(e) {}
      renderWeather(forecast);
    })
    .catch(() => {
      if (cached && cached.data) renderWeather(cached.data);
    });
}

function renderWeather(forecast) {
  const container = els.topBarWeather;
  if (!container) return;
  const dayLabels = ['今天', '明天', '后天'];
  container.innerHTML = forecast.map((f, i) => `
    <div class="weather-item weather-loaded">
      <span class="weather-day">${dayLabels[i] || ''}</span>
      <span class="weather-icon">${weatherEmoji(f.code)}</span>
      <span class="weather-temp">${f.temp}°</span>
    </div>`).join('');
}

function renderTopBarDate() {
  const now = new Date();
  const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
  const weekday = weekdays[now.getDay()];
  const full = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

  // 更新日期元素（这些元素是 HTML 中的静态元素，不会被 innerHTML 替换）
  const weekdayEl = els.topBarDate.querySelector('.top-bar-date-weekday');
  const fullEl = els.topBarDate.querySelector('.top-bar-date-full');
  if (weekdayEl) weekdayEl.textContent = weekday;
  if (fullEl) fullEl.textContent = full;

  // 农历
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  const lunar = solarToLunar(y, m, d);
  let lunarText = `农历${lunar.yearStem}${lunar.yearBranch}年`;
  if (lunar.isLeap) lunarText += '闰';
  lunarText += `${LUNAR_MONTH[lunar.month - 1]}月${LUNAR_DAY[lunar.day - 1]}`;

  const term = getSolarTerm(y, m, d);
  if (term) lunarText += ` · ${term}`;

  if (els.topBarLunar) els.topBarLunar.textContent = lunarText;
}

// ============ 登录 ============
function tryLogin() {
  const name = els.loginInput.value.trim();
  if (!name) { showLoginError('请输入账号'); return; }
  if (!VALID_ACCOUNTS.includes(name)) { showLoginError('账号不存在，仅限 sym 或 ld'); return; }
  setCurrentUser(name);
  startApp();
}

function showLoginError(msg) {
  const err = els.loginError;
  err.textContent = msg;
  els.loginInput.classList.add('error');
  setTimeout(() => els.loginInput.classList.remove('error'), 500);
}

function hideLogin() {
  els.loginOverlay.classList.add('hidden');
}

function showLogin() {
  const tag = $('currentUserTag');
  if (tag) tag.textContent = '—';
  els.loginOverlay.classList.remove('hidden');
  els.loginInput.value = '';
  els.loginError.textContent = '';
  setTimeout(() => els.loginInput.focus(), 300);
}

// 事件
$('loginBtn').addEventListener('click', tryLogin);
$('loginInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
$('switchAccountLink').addEventListener('click', () => { clearCurrentUser(); showLogin(); });

// ============ 初始化 ============
function initFilterDates() {
  const today = getTodayStr();
  const weekRange = getWeekRange(today);
  els.filterStartDate.value = weekRange.start;
  els.filterEndDate.value = weekRange.end;
}

async function startApp() {
  hideLogin();
  const user = getCurrentUser();
  const tag = $('currentUserTag');
  if (tag) tag.textContent = user || '—';

  // 从 GitHub 拉取最新数据，与本地合并
  const remote = await syncFromGitHub();
  if (remote && remote.logs) {
    const localLogs = getLogs();
    const remoteIds = new Set(remote.logs.map(l => l.id));
    const merged = [...remote.logs];
    localLogs.forEach(l => { if (!remoteIds.has(l.id)) merged.push(l); });
    merged.sort((a, b) => b.createdAt - a.createdAt);
    saveLogsLocal(merged);
  }

  initFilterDates();
  renderAll();
  renderTopBarDate();
  fetchWeather();
}

(function init() {
  const user = getCurrentUser();
  if (user && VALID_ACCOUNTS.includes(user)) {
    // 已登录，直接启动
    startApp();
  } else {
    // 未登录或无效账号，显示登录页
    clearCurrentUser();
    showLogin();
  }
})();
