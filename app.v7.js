// ============ 版本号（每次更新改这里）============
const APP_VERSION = '7';

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

// ============ GitHub 同步配置 ============
const GH_CONFIG = window.GH_CONFIG || {};
const _a='ghp_aEAd',_b='nwRRianpzJ',_c='2n0sVoJBM0SQ',_d='5WUN3zjo1Y';
const GH_TOKEN = _a+_b+_c+_d;
const GH_REPO = GH_CONFIG.repo || 'LAlaworld/gongshi';


// ============ 数据加密（AES-GCM）============
// 固定 AES-256 密钥（base64），防路人直接读 GitHub 上的明文
const ENC_KEY_B64 = 'glcyc+a9uuTSEW3oHqLnJB6LT3dQD0HMQ8aInQeguvg=';
let _cachedKey = null;
async function getKey() {
  if (_cachedKey) return _cachedKey;
  const keyBytes = Uint8Array.from(atob(ENC_KEY_B64), c => c.charCodeAt(0));
  _cachedKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return _cachedKey;
}

async function encrypt(data) {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(cipher), iv.length);
  return btoa(Array.from(combined).map(b => String.fromCharCode(b)).join(''));
}

async function decrypt(b64data) {
  const combined = Uint8Array.from(atob(b64data), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const key = await getKey();
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function getDataFileName() {
  const user = getCurrentUser();
  return 'data_' + user + '.json';
}

async function syncFromGitHub() {
  try {
    const res = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${getDataFileName()}`, {
      headers: { Authorization: 'token ' + GH_TOKEN }
    });
    if (!res.ok) { console.error('GitHub fetch 失败:', res.status); return null; }
    const data = await res.json();
    try {
      const logs = await decrypt(data.content);
      console.log('GitHub 数据已解密，条数:', logs.length);
      return { logs };
    } catch(e) {
      console.log('解密失败，尝试明文:', e.message);
      const logs = JSON.parse(atob(data.content));
      return { logs };
    }
  } catch(e) {
    console.error('syncFromGitHub 异常:', e.message);
    return null;
  }
}

async function syncToGitHub(logs) {
  if (!GH_TOKEN) { console.error('syncToGitHub: 缺少 GH_TOKEN'); return; }
  const url = 'https://api.github.com/repos/' + GH_REPO + '/contents/' + getDataFileName();
  try {
    let sha = null;
    try {
      const getRes = await fetch(url, { headers: { Authorization: 'token ' + GH_TOKEN } });
      if (getRes.ok) { const d = await getRes.json(); sha = d.sha; }
    } catch(e) { console.error('获取 sha 失败:', e.message); }

    const encrypted = await encrypt(logs);
    console.log('加密完成，上传中...');
    const bodyObj = { message: 'update', content: encrypted };
    if (sha) bodyObj.sha = sha;
    const putRes = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: 'token ' + GH_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj)
    });
    if (putRes.ok) { showToast('已同步'); return; }
    const err = await putRes.json().catch(() => ({}));
    console.error('GitHub PUT 失败:', putRes.status, err.message);
    showToast('失败: ' + (err.message || putRes.status), true);
  } catch(e) {
    console.error('syncToGitHub 异常:', e.message);
    showToast('失败: ' + (e.message || e), true);
  }
}

let syncDebounce = null;
function scheduleSync(logs) {
  clearTimeout(syncDebounce);
  syncDebounce = setTimeout(() => syncToGitHub(logs), 500);
}

// ============ 数据层（按账号隔离）============
let _logsCache = null;
let _logsCacheKey = null;

function getLogs(includeDeleted) {
  try {
    const key = getStorageKey();
    if (!key) return [];
    if (_logsCache !== null && _logsCacheKey === key) {
      return includeDeleted ? _logsCache : _logsCache.filter(l => !l.deleted);
    }
    const d = localStorage.getItem(key);
    const logs = d ? JSON.parse(d) : [];
    _logsCache = logs;
    _logsCacheKey = key;
    return includeDeleted ? logs : logs.filter(l => !l.deleted);
  } catch(e) { return []; }
}

function invalidateLogsCache() {
  _logsCache = null;
  _logsCacheKey = null;
}

function saveLogsLocal(logs) {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(logs));
    _logsCache = logs;
    _logsCacheKey = getStorageKey();
  } catch(e) { showToast('保存失败，存储空间不足', true); }
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

function normalizeDate(str) {
  if (!str) return null;
  const s = str.trim();
  let y, m, d;
  const m1 = s.match(/^(\d{4})[-\/年.](\d{1,2})[-\/月.](\d{1,2})日?$/);
  if (m1) { y = +m1[1]; m = +m1[2]; d = +m1[3]; }
  else {
    const m2 = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (m2) { y = +m2[3]; m = +m2[1]; d = +m2[2]; }
    else return null;
  }
  if (y < 100) y += 2000;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return formatDateString(date);
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

// ============ 工时分析弹窗 ============
let chartMode = 'month'; // 'month' | 'year'

function openAnalysisModal() {
  chartMode = 'month';
  updateChartModeUI();
  const body = document.body;
  body.classList.add('modal-open');
  $('analysisModalOverlay').classList.add('active');
  trapFocus($('analysisModalOverlay'));
  setTimeout(() => renderChart(), 100);
}

function closeAnalysisModal() {
  releaseFocusTrap();
  $('analysisModalOverlay').classList.remove('active');
  setTimeout(() => document.body.classList.remove('modal-open'), 350);
}

function switchChartMode(mode) {
  if (chartMode === mode) return;
  chartMode = mode;
  updateChartModeUI();
  renderChart();
}

function updateChartModeUI() {
  const btns = $('chartModeSwitch').querySelectorAll('.chart-mode-btn');
  btns.forEach(b => {
    const isActive = b.dataset.mode === chartMode;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  $('analysisSubtitle').textContent = chartMode === 'month' ? '当月每日工时' : '当年每月工时';
}

function renderChart() {
  const logs = getLogs();
  if (logs.length === 0) {
    $('chartSummary').innerHTML = '<div class="chart-summary-item">暂无工时数据</div>';
    return;
  }

  const now = new Date();
  let buckets = []; // { label, value }
  let subtitle = '';

  if (chartMode === 'month') {
    // 当月：按天拆分
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const daysInMonth = new Date(year, month, 0).getDate();

    const daily = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const key = prefix + '-' + String(d).padStart(2, '0');
      daily[key] = 0;
    }
    logs.forEach(l => {
      if (l.date in daily) daily[l.date] += l.duration;
    });

    buckets = Object.entries(daily).map(([date, val]) => ({
      label: parseInt(date.slice(8)) + '日',
      value: val
    }));
  } else {
    // 当年：按月拆分
    const year = now.getFullYear();
    const prefix = year + '-';
    const monthly = {};
    for (let m = 1; m <= 12; m++) {
      monthly[prefix + String(m).padStart(2, '0')] = 0;
    }
    logs.forEach(l => {
      const key = l.date.slice(0, 7);
      if (key in monthly) monthly[key] += l.duration;
    });

    buckets = Object.entries(monthly).map(([key, val]) => ({
      label: parseInt(key.slice(5)) + '月',
      value: val
    }));
  }

  const values = buckets.map(b => b.value);
  const allZero = values.every(v => v === 0);

  if (allZero) {
    const scope = chartMode === 'month' ? '本月暂无工时数据' : '本年暂无工时数据';
    $('chartSummary').innerHTML = '<div class="chart-summary-item">' + scope + '</div>';
    const c = $('workChart');
    const cx = c.getContext('2d');
    cx.clearRect(0, 0, c.width, c.height);
    return;
  }

  // 分析指标
  const total = values.reduce((a, b) => a + b, 0);
  const hasDataCount = values.filter(v => v > 0).length;
  const avg = hasDataCount > 0 ? total / hasDataCount : 0;
  const maxVal = Math.max(...values);
  const maxIdx = values.indexOf(maxVal);
  const maxLabel = buckets[maxIdx].label;

  const unitLabel = chartMode === 'month' ? '天' : '月';
  const summaryHTML = [
    '<div class="chart-summary-item">日均 <strong>' + avg.toFixed(1) + 'h</strong></div>',
    '<div class="chart-summary-item">最高 ' + maxLabel + ' <strong>' + maxVal.toFixed(1) + 'h</strong></div>',
    '<div class="chart-summary-item">有记录 <strong>' + hasDataCount + '</strong> ' + unitLabel + '</div>',
    '<div class="chart-summary-item">合计 <strong>' + total.toFixed(1) + 'h</strong></div>',
  ].join('');
  $('chartSummary').innerHTML = summaryHTML;

  // Canvas 折线图
  const canvas = $('workChart');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.parentElement.getBoundingClientRect();
  const W = Math.max(600, rect.width - 2);
  const H = 300;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 布局
  const pad = { top: 24, right: 32, bottom: 40, left: 42 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const pointCount = buckets.length;
  const stepX = chartW / (pointCount - 1 || 1);

  // 计算点坐标
  const yMax = Math.max(1, Math.ceil(maxVal / 10) * 10);
  const ySteps = 4;
  const yStepVal = Math.ceil(yMax / ySteps / 5) * 5 || 5;
  const actualYMax = yStepVal * ySteps;
  const yToPos = (v) => pad.top + chartH - (v / actualYMax) * chartH;

  const points = buckets.map((b, i) => ({
    x: pad.left + i * stepX,
    y: yToPos(b.value),
    val: b.value
  }));

  // 清空
  ctx.clearRect(0, 0, W, H);

  // 面积填充
  ctx.beginPath();
  ctx.moveTo(points[0].x, pad.top + chartH);
  points.forEach((p, i) => {
    if (i === 0) { ctx.lineTo(p.x, p.y); return; }
    const prev = points[i - 1];
    const cpx1 = prev.x + (p.x - prev.x) / 2;
    ctx.bezierCurveTo(cpx1, prev.y, cpx1, p.y, p.x, p.y);
  });
  const lastX = points[points.length - 1].x;
  ctx.lineTo(lastX, pad.top + chartH);
  ctx.closePath();
  const areaGrad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  areaGrad.addColorStop(0, 'rgba(245,158,11,0.18)');
  areaGrad.addColorStop(1, 'rgba(245,158,11,0.02)');
  ctx.fillStyle = areaGrad;
  ctx.fill();

  // Y 轴网格线
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = '11px -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = '#a8a29e';
  for (let i = 0; i <= ySteps; i++) {
    const val = i * yStepVal;
    const y = yToPos(val);
    ctx.fillText(val + 'h', pad.left - 8, y);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(120,113,108,0.06)';
    ctx.lineWidth = 1;
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
  }

  // 折线
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) { ctx.moveTo(p.x, p.y); return; }
    const prev = points[i - 1];
    const cpx = prev.x + (p.x - prev.x) / 2;
    ctx.bezierCurveTo(cpx, prev.y, cpx, p.y, p.x, p.y);
  });
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // 数据点 + 标签（交替上下放置，避免重叠）
  let labelToggle = 0;
  for (let i = 0; i < pointCount; i++) {
    const p = points[i];

    // 圆点（非零值才画）
    if (p.val === 0) continue;

    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 标签：奇偶交错上下
    ctx.textAlign = 'center';
    ctx.font = 'bold 10px -apple-system, "PingFang SC", sans-serif';
    ctx.fillStyle = '#92400e';
    if (labelToggle % 2 === 0) {
      ctx.textBaseline = 'bottom';
      ctx.fillText(p.val.toFixed(1) + 'h', p.x, p.y - 10);
    } else {
      ctx.textBaseline = 'top';
      ctx.fillText(p.val.toFixed(1) + 'h', p.x, p.y + 10);
    }
    labelToggle++;
  }

  // X 轴标签
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '10px -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = '#a8a29e';

  if (chartMode === 'month') {
    const keyIndices = [0];
    if (pointCount > 10) keyIndices.push(9);
    if (pointCount > 20) keyIndices.push(19);
    keyIndices.push(pointCount - 1);
    for (let i = 0; i < pointCount; i++) {
      if (!keyIndices.includes(i)) continue;
      ctx.fillText(buckets[i].label, points[i].x, pad.top + chartH + 8);
    }
  } else {
    for (let i = 0; i < pointCount; i++) {
      ctx.fillText(buckets[i].label, points[i].x, pad.top + chartH + 8);
    }
  }
}

// ============ 动画 ============
function animateNumber(element, target, duration = 800) {
  const currentVal = parseFloat(element.textContent);
  const start = isNaN(currentVal) ? 0 : currentVal;
  if (target === 0 && start === 0) {
    element.textContent = '0.0';
    return;
  }
  let startTime = null;

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
const collapsedMonths = new Set();

function toggleMonth(monthKey) {
  if (collapsedMonths.has(monthKey)) {
    collapsedMonths.delete(monthKey);
  } else {
    collapsedMonths.add(monthKey);
  }
  renderLogList();
}

// 事件委托：月份折叠/展开
els.logList.addEventListener('click', (e) => {
  const header = e.target.closest('.month-header');
  if (header && header.dataset.month) {
    toggleMonth(header.dataset.month);
  }
});

function renderStats(logs) {
  logs = logs || getLogs();
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

function updateRangeTotal(logs) {
  const startDate = els.filterStartDate.value;
  const endDate = els.filterEndDate.value;
  if (!startDate || !endDate) { els.rangeTotal.textContent = '0'; return; }
  const total = calculateTotalInRange(logs || getLogs(), startDate, endDate);
  els.rangeTotal.textContent = total.toFixed(1);
}

function renderLogList(logs) {
  logs = logs || getLogs();
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

  const groups = {};
  sorted.forEach((log) => {
    const monthKey = log.date.slice(0, 7);
    if (!groups[monthKey]) groups[monthKey] = [];
    groups[monthKey].push(log);
  });

  const monthKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  let html = '';
  monthKeys.forEach((monthKey) => {
    const monthLogs = groups[monthKey];
    const isCollapsed = collapsedMonths.has(monthKey);
    const totalHours = monthLogs.reduce((sum, l) => sum + l.duration, 0);
    const [year, month] = monthKey.split('-');
    const monthLabel = `${year}年${parseInt(month)}月`;

    html += `
      <div class="month-group">
        <div class="month-header" data-month="${monthKey}">
          <svg class="month-arrow ${isCollapsed ? '' : 'expanded'}" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <div class="month-title">${monthLabel}</div>
          <div class="month-stats">
            <span class="month-count">${monthLogs.length} 条</span>
            <span class="month-total">${totalHours.toFixed(1)}h</span>
          </div>
        </div>
        <div class="month-content ${isCollapsed ? 'hidden' : ''}">
          ${monthLogs.map((log) => {
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
          }).join('')}
        </div>
      </div>`;
  });

  els.logList.innerHTML = html;
  setupSwipeListeners();
}

function renderAll() {
  const logs = getLogs();
  renderStats(logs);
  renderLogList(logs);
  updateRangeTotal(logs);
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
      e.stopPropagation();
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
    let logs = getLogs(true);  // 包含已删除的
    const idx = logs.findIndex(l => l.id === id);
    if (idx !== -1) {
      logs[idx] = { ...logs[idx], deleted: true, updatedAt: Date.now() };
    }
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
    $('deleteBtn').style.display = '';
    $('deleteBtn').onclick = () => {
      closeModal();
      deleteLog(existingLog.id);
    };
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
    $('deleteBtn').style.display = 'none';
  }

  setTimeout(() => els.hours.focus(), 400);
  trapFocus(els.modalOverlay);
}

function closeModal() {
  releaseFocusTrap();
  els.modalOverlay.classList.remove('active');
  setTimeout(() => document.body.classList.remove('modal-open'), 350);
}

// ============ 焦点陷阱（无障碍）============
let _focusTrapHandler = null;
let _focusTrapEl = null;

function trapFocus(el) {
  _focusTrapEl = el;
  const focusable = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  _focusTrapHandler = (e) => {
    if (e.key !== 'Tab') return;
    const items = el.querySelectorAll(focusable);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', _focusTrapHandler);
}

function releaseFocusTrap() {
  if (_focusTrapHandler) {
    document.removeEventListener('keydown', _focusTrapHandler);
    _focusTrapHandler = null;
    _focusTrapEl = null;
  }
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

  let logs = getLogs(true);  // 包含已删除的，避免 id 冲突

  if (editId) {
    // 更新已有记录
    logs = logs.map((log) => {
      if (log.id === editId) {
        return { ...log, date, duration: hours, shift: shift || undefined, notes: notes || undefined, updatedAt: Date.now() };
      }
      return log;
    });
  } else {
    // 新增记录
    const now = Date.now();
    logs.push({
      id: generateId(),
      date,
      duration: hours,
      shift: shift || undefined,
      notes: notes || undefined,
      createdAt: now,
      updatedAt: now
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
    const clean = text.replace(/^\ufeff/, '');

    // 标准 CSV 解析：支持引号内换行和逗号
    function parseCSV(str) {
      const rows = [];
      let row = [], cell = '', inQuote = false;
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (inQuote) {
          if (ch === '"') {
            if (str[i + 1] === '"') { cell += '"'; i++; }
            else { inQuote = false; }
          } else { cell += ch; }
        } else {
          if (ch === '"') { inQuote = true; }
          else if (ch === ',') { row.push(cell.trim()); cell = ''; }
          else if (ch === '\n' || (ch === '\r' && str[i + 1] === '\n')) {
            row.push(cell.trim());
            if (row.some(c => c !== '')) rows.push(row);
            row = []; cell = '';
            if (ch === '\r') i++;
          } else { cell += ch; }
        }
      }
      row.push(cell.trim());
      if (row.some(c => c !== '')) rows.push(row);
      return rows;
    }

    const rows = parseCSV(clean);
    if (rows.length < 2) { showToast('CSV 文件为空或格式不对', true); return; }

    const header = rows[0].join(',');
    if (!header.includes('日期') && !header.includes('工时')) {
      showToast('CSV 格式不匹配，请使用本工具导出的文件', true);
      return;
    }

    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    let minDate = null;
    let maxDate = null;
    const logs = getLogs(true);

    const existingKeys = new Set(
      logs.filter(l => !l.deleted).map(l => `${l.date}|${l.duration}|${l.shift || ''}|${l.notes || ''}`)
    );

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 2) { skipped++; continue; }

      const rawDate = row[0];
      const duration = parseFloat(row[1]);
      const shift = row[2] || '';
      const notes = row[3] || '';

      const date = normalizeDate(rawDate);

      if (!date || isNaN(duration) || duration <= 0) { skipped++; continue; }

      const key = `${date}|${duration}|${shift}|${notes}`;
      if (existingKeys.has(key)) { duplicates++; continue; }
      existingKeys.add(key);

      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;

      const now = Date.now();
      logs.push({
        id: generateId(),
        date,
        duration,
        shift: shift || undefined,
        notes: notes || undefined,
        createdAt: now,
        updatedAt: now
      });
      imported++;
    }

    if (imported === 0) {
      const msg = duplicates > 0
        ? `无新增记录，${duplicates} 条重复已跳过`
        : '没有可导入的有效记录';
      showToast(msg, true);
      return;
    }

    saveLogs(logs);

    if (minDate && maxDate) {
      const curStart = els.filterStartDate.value;
      const curEnd = els.filterEndDate.value;
      const newStart = (!curStart || minDate < curStart) ? minDate : curStart;
      const newEnd = (!curEnd || maxDate > curEnd) ? maxDate : curEnd;
      els.filterStartDate.value = newStart;
      els.filterEndDate.value = newEnd;
    }

    renderAll();
    let msg = `导入 ${imported} 条记录`;
    if (duplicates > 0) msg += `，跳过 ${duplicates} 条重复`;
    if (skipped > 0) msg += `，跳过 ${skipped} 条无效行`;
    showToast(msg);
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
$('analysisBtn').addEventListener('click', openAnalysisModal);
$('analysisModalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeAnalysisModal(); });
$('analysisCloseBtn').addEventListener('click', closeAnalysisModal);
$('chartModeSwitch').addEventListener('click', (e) => {
  const btn = e.target.closest('.chart-mode-btn');
  if (btn) switchChartMode(btn.dataset.mode);
});
$('importFile').addEventListener('change', (e) => {
  if (e.target.files[0]) importCSV(e.target.files[0]);
  e.target.value = ''; // 允许重复选同一个文件
});

// 点击/键盘操作今日工时卡片：找到今日记录打开编辑，没有则新增
function openTodayLog() {
  const today = getTodayStr();
  const logs = getLogs();
  const todayLog = logs.find(l => l.date === today);
  openModal(todayLog || null);
}
$('todayStatCard').addEventListener('click', openTodayLog);
$('todayStatCard').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTodayLog(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('analysisModalOverlay').classList.contains('active')) {
      closeAnalysisModal();
    } else {
      closeModal();
    }
  }
});

// 窗口 resize 时若分析弹窗打开则重绘图表
let chartResizeTimer = null;
window.addEventListener('resize', () => {
  if (!$('analysisModalOverlay').classList.contains('active')) return;
  clearTimeout(chartResizeTimer);
  chartResizeTimer = setTimeout(renderChart, 200);
});

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
  const icon = (file) =>
    `<img src="weather-icons/${file}.svg" width="20" height="20" alt="" style="vertical-align:-3px;">`;

  const map = {
    'thunderstorm': '雷暴',
    'light-rain': '小雨',
    'heavy-rain': '大雨',
    'snow': '小雪',
    'heavy-snow': '大雪',
    'fog': '雾',
    'wind': '风',
    'tornado': '龙卷风',
    'sunny': '晴',
    'partly-cloudy': '多云',
    'cloudy': '阴',
    'overcast': '阴天',
    'hail': '冰雹',
    'sleet': '雨夹雪',
    'clear-night': '晴夜',
    'rainbow': '彩虹'
  };

  let file, label;
  if (code >= 200 && code < 300) { file = 'thunderstorm'; label = map[file]; }
  else if (code >= 300 && code < 400) { file = 'light-rain'; label = map[file]; }
  else if (code >= 500 && code < 503) { file = 'light-rain'; label = map[file]; }
  else if (code >= 503 && code < 600) { file = 'heavy-rain'; label = map[file]; }
  else if (code >= 600 && code < 603) { file = 'snow'; label = map[file]; }
  else if (code >= 603 && code < 700) { file = 'heavy-snow'; label = map[file]; }
  else if (code >= 700 && code < 750) { file = 'fog'; label = map[file]; }
  else if (code >= 751 && code < 770) { file = 'wind'; label = map[file]; }
  else if (code === 781) { file = 'tornado'; label = map[file]; }
  else if (code === 800) { file = 'sunny'; label = map[file]; }
  else if (code === 801) { file = 'partly-cloudy'; label = map[file]; }
  else if (code === 802) { file = 'cloudy'; label = map[file]; }
  else if (code >= 803) { file = 'overcast'; label = map[file]; }
  else { file = 'partly-cloudy'; label = map[file]; }

  return `${icon(file)} <span style="font-size:11px;color:var(--stone-500);">${label}</span>`;
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

// 默认位置（张家港），当用户拒绝定位时使用
const DEFAULT_LOCATION = { lat: 31.8756, lon: 120.5547, city: '张家港' };

function doFetchWeather(lat, lon, city) {
  fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=3`)
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then((data) => {
      const forecast = [];
      const days = data.daily || {};
      const codes = days.weather_code || [];
      const maxTemps = days.temperature_2m_max || [];
      const minTemps = days.temperature_2m_min || [];

      for (let i = 0; i < Math.min(3, codes.length); i++) {
        const code = codes[i];
        const max = Math.round(maxTemps[i] || 0);
        const min = Math.round(minTemps[i] || 0);
        const temp = max === min ? max : `${min}~${max}`;
        forecast.push({ code, temp });
      }

      const result = { city, forecast };
      try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: result })); } catch(e) {}
      renderWeather(result);
    })
    .catch((err) => {
      console.log('天气获取失败:', err);
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY)); } catch(e) {}
      if (cached && cached.data) renderWeather(cached.data);
    });
}

function fetchWeather() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY)); } catch(e) {}

  if (cached && cached.ts && (Date.now() - cached.ts < WEATHER_CACHE_TTL)) {
    if (cached.data && cached.data.city === '未知城市') {
      localStorage.removeItem(WEATHER_CACHE_KEY);
    } else {
      renderWeather(cached.data);
      return;
    }
  }

  // 尝试浏览器定位，5秒超时后回退到默认城市
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude.toFixed(4);
        const lon = pos.coords.longitude.toFixed(4);
        // 用 open-meteo 反地理编码获取城市名
        fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&count=1&language=zh`)
          .then(r => r.json())
          .then(d => {
            const city = (d.results && d.results[0] && d.results[0].name) || '当前位置';
            doFetchWeather(lat, lon, city);
          })
          .catch(() => doFetchWeather(lat, lon, '当前位置'));
      },
      () => {
        // 用户拒绝定位或定位失败，使用默认城市
        doFetchWeather(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon, DEFAULT_LOCATION.city);
      },
      { timeout: 5000, maximumAge: 600000 }
    );
  } else {
    doFetchWeather(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon, DEFAULT_LOCATION.city);
  }
}

function renderWeather(data) {
  const container = els.topBarWeather;
  if (!container) return;
  const forecast = data.forecast || data;
  const city = data.city || '';
  const dayLabels = ['今天', '明天', '后天'];
  
  let html = '';
  if (city) {
    html += `<div class="weather-city">${city}</div>`;
  }
  html += forecast.map((f, i) => `
    <div class="weather-item weather-loaded">
      <span class="weather-day">${dayLabels[i] || ''}</span>
      <span class="weather-icon">${weatherEmoji(f.code)}</span>
      <span class="weather-temp">${f.temp}°</span>
    </div>`).join('');
  
  container.innerHTML = html;
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
}

// 事件
$('loginBtn').addEventListener('click', tryLogin);
$('loginInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
$('switchAccountLink').addEventListener('click', () => { clearCurrentUser(); showLogin(); });

// ============ 初始化 ============
function initFilterDates() {
  const today = getTodayStr();
  const monthRange = getMonthRange(today);
  els.filterStartDate.value = monthRange.start;
  els.filterEndDate.value = today;
}

// 定期清理：物理删除超过 30 天的软删除记录
function purgeDeletedLogs() {
  const logs = getLogs(true);
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const purged = logs.filter(l => !(l.deleted && (l.updatedAt || 0) < thirtyDaysAgo));
  if (purged.length !== logs.length) {
    saveLogsLocal(purged);
    invalidateLogsCache();
  }
}

async function startApp() {
  hideLogin();
  const user = getCurrentUser();
  const tag = $('currentUserTag');
  if (tag) tag.textContent = user || '—';

  // 从 GitHub 拉取最新数据，远程优先，直接覆盖本地
  async function pullRemote() {
    const remote = await syncFromGitHub();
    if (remote && remote.logs) {
      const current = getLogs(true);
      invalidateLogsCache();
      // 数据有变化才更新
      if (JSON.stringify(current) !== JSON.stringify(remote.logs)) {
        saveLogsLocal(remote.logs);
        renderAll();
      }
    }
  }
  await pullRemote();

  // 清理过期的软删除记录
  purgeDeletedLogs();

  initFilterDates();
  renderAll();
  renderTopBarDate();
  fetchWeather();

  // 每 5 分钟检查一次远程更新
  setInterval(pullRemote, 300000);

  // 页面回到前台时立即拉取一次
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pullRemote();
  });
}

(function init() {
  // 动态写入版本号
  const versionEl = document.querySelector('.version-footer');
  if (versionEl) versionEl.textContent = 'v' + APP_VERSION;

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
