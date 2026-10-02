import * as PIXI from 'pixi.js';
import { Spine } from 'pixi-spine';

const W = 480;
const H = 700;
const MODEL_BASE = '/assets/models/skadi2/';
const SKEL_FILE = 'skadi2.skel';

// 走路动画与回落动画的识别优先级
const WALK_ANIMS = ['Move', 'Walk', 'Run'];
const FALLBACK_ANIMS = ['Default', 'Idle', 'Relax', 'Stand'];

let cfg = null;
let app = null;
let spine = null;
let spineData = null;
let animNames = [];
let currentAnimName = null;
let refBox = null; // 当前动画一整圈的包围盒并集（本地坐标）
let facing = 1;    // 走路朝向：1 右，-1 左
let modelRect = { x: 0, y: 0, w: 0, h: 0 };

let action = 'Default';  // 当前动作：动画名或 'random'
let oneShotName = null;  // 正在播放的单次动画
let randomTimer = null;
let lastRandomName = null;

let bubbleOpen = false;
let hideTimer = null;
let chatBusy = false;
let history = [];
const pendingReplies = new Map();

let interactive = false;
let dragStartPos = null;
let dragMoved = false;
let dragging = false;
let rectTick = 0;

const $ = (id) => document.getElementById(id);
const bubbleEl = $('bubble');
const chatlogEl = $('chatlog');
const chatinEl = $('chatin');
const sendEl = $('send');
const ctxMenuEl = $('ctxmenu');

// 调试钩子（CDP 排查用）
window.__pet = { errors: [], loaded: false, get spine() { return spine; }, get cfg() { return cfg; } };
window.addEventListener('error', (e) =>
  window.__pet.errors.push(String((e.error && e.error.stack) || e.message || e)));
window.addEventListener('unhandledrejection', (e) =>
  window.__pet.errors.push('unhandled: ' + String((e.reason && e.reason.stack) || e.reason)));

boot().catch((e) => console.error('boot failed: ' + (e && e.stack || e)));

async function boot() {
  cfg = await window.pet.getConfig();
  buildApp();
  try {
    await loadModel();
  } catch (e) {
    console.error('模型加载失败: ' + (e && e.stack || e));
    window.__pet.errors.push(String(e && e.stack || e));
    return;
  }
  bindUI();
  applyBubbleStyle();
  subscribe();

  // 未配置 API 时主动提示一次
  if (!cfg.api.baseUrl || !cfg.api.model) {
    openBubble();
    addMsg('assistant', '你好，我是斯卡蒂。右键我可以打开设置，填好 API 就能和我对话啦。');
  }
}

function buildApp() {
  app = new PIXI.Application({
    width: W,
    height: H,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true
  });
  $('stage').appendChild(app.view);
  app.ticker.add(() => {
    if (!spine) return;
    if (++rectTick % 30 === 0) {
      const b = spine.getBounds(true);
      modelRect = { x: b.x, y: b.y, w: b.width, h: b.height };
      positionBubble();
    }
  });
}

async function loadModel() {
  // Assets.load('.skel') 返回 { spineData, spineAtlas } 包装对象
  const loaded = await PIXI.Assets.load(MODEL_BASE + SKEL_FILE);
  spineData = loaded && loaded.spineData ? loaded.spineData : loaded;
  spine = new Spine(spineData);
  app.stage.addChild(spine);
  animNames = (spineData.animations || []).map((a) => a.name);
  console.log('动画列表: ' + animNames.join(', '));
  window.pet.reportAnims(animNames);
  spine.state.addListener({
    complete: (entry) => {
      // 单次动画播完后回到当前动作
      if (oneShotName && entry && entry.animation && entry.animation.name === oneShotName) {
        oneShotName = null;
        window.pet.setState({ oneShot: false });
        playState(action === 'random' ? fallbackAnim() : action);
      }
    }
  });
  setupMixes();
  applyAction(cfg.model.action || 'Default');
  measureRefBox();
  applyScale();
  window.__pet.loaded = true;
  window.__pet.anims = animNames;
}

function setupMixes() {
  const stateData = spine && spine.state && spine.state.data;
  if (!stateData || !stateData.setMix) return;
  for (const a of animNames) {
    for (const b of animNames) {
      if (a !== b) {
        try { stateData.setMix(a, b, 0.2); } catch (e) { /* 忽略 */ }
      }
    }
  }
}

function measureRefBox() {
  if (!spine) return;
  spine.scale.set(1);
  spine.position.set(0, 0);
  const entry = spine.state.getCurrent(0);
  const dur = (entry && entry.animation && entry.animation.duration) || 1;
  const N = 14;
  let box = null;
  for (let i = 0; i < N; i++) {
    spine.update(dur / N);
    const b = spine.getBounds(true);
    if (!box) {
      box = { x: b.x, y: b.y, w: b.width, h: b.height };
    } else {
      const x0 = Math.min(box.x, b.x);
      const y0 = Math.min(box.y, b.y);
      const x1 = Math.max(box.x + box.w, b.x + b.width);
      const y1 = Math.max(box.y + box.h, b.y + b.height);
      box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
  }
  if (box && box.w > 0 && box.h > 0) refBox = box;
}

function applyScale() {
  if (!spine) return;
  if (!refBox) measureRefBox();
  if (!refBox) return;
  const targetH = 430 * (Number(cfg.model.scale) || 1);
  const maxW = 460;
  const s = Math.min(targetH / refBox.h, maxW / refBox.w);
  spine.scale.set(facing * s, s);
  // 以参考包围盒底边中心为锚点
  spine.position.set(
    W / 2 - facing * s * (refBox.x + refBox.w / 2),
    H - s * (refBox.y + refBox.h)
  );
  const b2 = spine.getBounds(true);
  modelRect = { x: b2.x, y: b2.y, w: b2.width, h: b2.height };
  positionBubble();
}

// 气泡底边严格位于模型实际顶部上方 1/6 模型高度处
function positionBubble() {
  const gap = modelRect.h / 6;
  const bottomEdge = modelRect.y - gap;
  bubbleEl.style.bottom = (H - bottomEdge) + 'px';
  bubbleEl.style.top = 'auto';
  // 气泡过高时避免顶部越出窗口
  const top = bubbleEl.getBoundingClientRect().top;
  if (top < 4) {
    bubbleEl.style.bottom = (H - 4 - bubbleEl.offsetHeight) + 'px';
  }
}

/* ---------------- 动作控制 ---------------- */

function walkAnimName() {
  return WALK_ANIMS.find((n) => animNames.includes(n));
}

function fallbackAnim() {
  return FALLBACK_ANIMS.find((n) => animNames.includes(n)) || animNames[0];
}

function setWalking(flag) {
  window.pet.setState({ walking: !!flag });
}

function playState(name) {
  if (!spine || !animNames.includes(name)) return;
  if (currentAnimName === name && oneShotName == null) return;
  currentAnimName = name;
  spine.state.setAnimation(0, name, true);
}

// 播放单次动画，播完回到当前动作
function playOnce(name) {
  if (!spine || !animNames.includes(name)) return;
  oneShotName = name;
  currentAnimName = name;
  window.pet.setState({ oneShot: true });
  spine.state.setAnimation(0, name, false);
}

// 应用当前动作：动画名循环播放，'random' 进入随机模式
function applyAction(next) {
  if (!spine) return;
  action = next === 'random' ? 'random' : (animNames.includes(next) ? next : fallbackAnim());
  if (action === 'random') {
    randomSegment();
  } else {
    stopRandom();
    setWalking(action === walkAnimName());
    playState(action);
  }
}

function randomSegment() {
  if (action !== 'random' || !animNames.length) return;
  const pool = animNames.filter((n) => n !== lastRandomName);
  const name = pool.length ? pool[Math.floor(Math.random() * pool.length)] : animNames[0];
  lastRandomName = name;
  setWalking(name === walkAnimName());
  playState(name);
  scheduleRandom();
}

function scheduleRandom() {
  clearTimeout(randomTimer);
  let lo = Number(cfg.model.randomMinSec) || 6;
  let hi = Number(cfg.model.randomMaxSec) || 15;
  if (hi < lo) [lo, hi] = [hi, lo];
  const sec = lo + Math.random() * Math.max(0, hi - lo);
  randomTimer = setTimeout(() => {
    if (action === 'random') randomSegment();
  }, sec * 1000);
}

function stopRandom() {
  clearTimeout(randomTimer);
  randomTimer = null;
  setWalking(false);
}

/* ---------------- 事件订阅 ---------------- */

function subscribe() {
  window.pet.on('config:changed', onConfigChanged);
  window.pet.on('walk:dir', (dir) => {
    facing = dir >= 0 ? 1 : -1;
    applyScale();
  });
  window.pet.on('anim:play', (name) => {
    if (animNames.includes(name)) playOnce(name);
  });
  window.pet.on('llm:chunk', ({ id, delta }) => {
    const p = pendingReplies.get(id);
    if (!p) return;
    if (p.el.classList.contains('thinking')) {
      p.el.classList.remove('thinking');
      p.el.textContent = '';
    }
    p.el.textContent += delta;
    scrollLog();
  });
  window.pet.on('llm:done', ({ id, aborted }) => {
    const p = pendingReplies.get(id);
    pendingReplies.delete(id);
    if (p) {
      if (aborted && !p.el.textContent) p.el.textContent = '（已取消）';
      if (p.el.textContent) history.push({ role: 'assistant', content: p.el.textContent });
      if (history.length > 40) history = history.slice(-40);
    }
    chatBusy = false;
    endChat();
  });
  window.pet.on('llm:error', ({ id, message }) => {
    const p = pendingReplies.get(id);
    pendingReplies.delete(id);
    chatBusy = false;
    if (p) {
      p.el.classList.remove('thinking');
      p.el.textContent = '出错了：' + message;
    }
    endChat();
  });
  window.pet.on('chat:cleared', () => {
    history = [];
    chatlogEl.innerHTML = '';
  });
}

function onConfigChanged(next) {
  const prev = cfg;
  cfg = next;
  applyBubbleStyle();
  if (!prev || prev.model.action !== cfg.model.action) {
    applyAction(cfg.model.action);
  }
  if (!prev || prev.model.scale !== cfg.model.scale) {
    applyScale();
  }
}

/* ---------------- 气泡与对话 ---------------- */

function applyBubbleStyle() {
  const b = cfg.bubble;
  bubbleEl.style.setProperty('--bg', b.bg);
  bubbleEl.style.setProperty('--fg', b.color);
  bubbleEl.style.setProperty('--op', b.opacity);
  bubbleEl.style.setProperty('--fs', b.fontSize + 'px');
  bubbleEl.style.setProperty('--w', b.width + 'px');
  bubbleEl.style.setProperty('--h', b.height + 'px');
}

function openBubble() {
  bubbleOpen = true;
  clearTimeout(hideTimer);
  bubbleEl.classList.remove('hidden');
  setTimeout(() => chatinEl.focus(), 60);
}

function closeBubble() {
  bubbleOpen = false;
  bubbleEl.classList.add('hidden');
  chatBusy = false;
  window.pet.setState({ chatActive: false });
  window.pet.chatAbort();
  clearTimeout(hideTimer);
}

function endChat() {
  window.pet.setState({ chatActive: false });
  clearTimeout(hideTimer);
  const sec = Number(cfg.bubble.autoHideSec) || 0;
  if (sec > 0 && bubbleOpen) {
    hideTimer = setTimeout(() => {
      if (document.activeElement !== chatinEl) closeBubble();
    }, sec * 1000);
  }
}

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.textContent = text;
  chatlogEl.appendChild(div);
  chatlogEl.scrollTop = chatlogEl.scrollHeight;
  return div;
}

function scrollLog() {
  chatlogEl.scrollTop = chatlogEl.scrollHeight;
}

async function onSend() {
  const text = chatinEl.value.trim();
  if (!text || chatBusy) return;
  chatBusy = true;
  chatinEl.value = '';
  openBubble();
  addMsg('user', text);
  history.push({ role: 'user', content: text });
  window.pet.setState({ chatActive: true });
  const aEl = addMsg('assistant', '思考中');
  aEl.classList.add('thinking');
  try {
    const id = await window.pet.chat(history.slice(-20));
    pendingReplies.set(id, { el: aEl });
  } catch (e) {
    chatBusy = false;
    aEl.classList.remove('thinking');
    aEl.textContent = '出错了：' + (e && e.message || e);
  }
}

/* ---------------- 鼠标交互 ---------------- */

function bindUI() {
  const cv = app.view;

  cv.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragStartPos = { x: e.screenX, y: e.screenY };
    dragMoved = false;
  });

  window.addEventListener('mousemove', onMouseMove);

  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (dragStartPos) {
      if (!dragMoved) {
        // 视为一次左键点击：开/关对话框
        if (bubbleOpen) closeBubble();
        else openBubble();
      }
      dragStartPos = null;
      dragging = false;
      window.pet.dragEnd();
      window.pet.setState({ dragging: false });
    }
  });

  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMenu(e.clientX, e.clientY);
  });

  ctxMenuEl.addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    hideMenu();
    if (act === 'settings') window.pet.openSettings();
    else if (act === 'quit') window.pet.quitApp();
  });

  window.addEventListener('blur', hideMenu);
  document.addEventListener('mousedown', (e) => {
    if (!ctxMenuEl.contains(e.target)) hideMenu();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideMenu();
      if (bubbleOpen) closeBubble();
    }
  });

  sendEl.addEventListener('click', onSend);
  chatinEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSend();
  });
  chatinEl.addEventListener('focus', () => clearTimeout(hideTimer));
}

function onMouseMove(e) {
  // 拖动窗口
  if (dragStartPos && (e.buttons & 1)) {
    const dx = e.screenX - dragStartPos.x;
    const dy = e.screenY - dragStartPos.y;
    if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 6) {
      dragMoved = true;
      dragging = true;
      window.pet.dragStart();
      window.pet.setState({ dragging: true });
    }
    if (dragMoved) {
      window.pet.dragMove(dx, dy);
      dragStartPos = { x: e.screenX, y: e.screenY };
    }
  }

  // 悬停在模型或 UI 上时取消鼠标穿透
  const overModel =
    e.clientX >= modelRect.x - 6 && e.clientX <= modelRect.x + modelRect.w + 6 &&
    e.clientY >= modelRect.y - 6 && e.clientY <= modelRect.y + modelRect.h + 6;
  let overUI = !ctxMenuEl.classList.contains('hidden');
  if (bubbleOpen) {
    const r = bubbleEl.getBoundingClientRect();
    overUI = overUI ||
      (e.clientX >= r.left - 8 && e.clientX <= r.right + 8 &&
       e.clientY >= r.top - 8 && e.clientY <= r.bottom + 8);
  }
  const nowInteractive = dragging || overModel || overUI;
  if (nowInteractive !== interactive) {
    interactive = nowInteractive;
    window.pet.setInteractive(interactive);
  }
}

function showMenu(x, y) {
  ctxMenuEl.classList.remove('hidden');
  const mw = ctxMenuEl.offsetWidth;
  const mh = ctxMenuEl.offsetHeight;
  const left = Math.min(x, W - mw - 4);
  const top = Math.min(y, H - mh - 4);
  ctxMenuEl.style.left = left + 'px';
  ctxMenuEl.style.top = top + 'px';
  // 原点感知：菜单从点击处展开（贴近边缘时从对应角）
  ctxMenuEl.style.transformOrigin =
    (x > left + mw / 2 ? 'right' : 'left') + ' ' +
    (y > top + mh / 2 ? 'bottom' : 'top');
}

function hideMenu() {
  ctxMenuEl.classList.add('hidden');
}
