const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const config = require('./config');
const { createServer } = require('./server');
const llm = require('./llm');

let baseURL = '';
let petWin = null;
let settingsWin = null;
let animNames = [];               // 渲染进程加载模型后上报的动画列表
const petState = { dragging: false, chatActive: false, oneShot: false, walking: false };
let walkDir = 1;
const WALK_TICK = 33;
const PET_W = 480;
const PET_H = 700;

// 把桌宠窗口限制在整个屏幕内（可自由覆盖任务栏区域，但不会被拖出屏幕丢失）
function clampPetPos(x, y) {
  const b = screen.getPrimaryDisplay().bounds;
  const cx = Math.min(Math.max(b.x, x), b.x + b.width - PET_W);
  const cy = Math.min(Math.max(b.y, y), b.y + b.height - PET_H);
  return [Math.round(cx), Math.round(cy)];
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (petWin) {
      if (petWin.isMinimized()) petWin.restore();
      petWin.show();
      petWin.focus();
    }
  });
}

function createPetWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const [ix, iy] = clampPetPos(wa.x + wa.width - PET_W - 20, wa.y + wa.height - PET_H);
  petWin = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: ix,
    y: iy,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    roundedCorners: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.loadURL(baseURL + '/static/index.html');
  petWin.once('ready-to-show', () => petWin.show());
  petWin.webContents.on('console-message', (e, level, message) => {
    console.log('[renderer]', message);
  });
  petWin.webContents.on('render-process-gone', (e, details) => {
    console.error('[pet] renderer gone:', details && details.reason);
  });
  petWin.webContents.on('did-finish-load', () => {
    // 渲染层 20 秒内未上报动画列表则自动重载一次（防启动竞态）
    setTimeout(() => {
      if (animNames.length === 0 && petWin && !petWin.isDestroyed()) {
        console.log('[pet] renderer not ready, reloading...');
        petWin.webContents.reload();
      }
    }, 20000);
  });
  // 初始为可穿透：等渲染进程报告鼠标位于模型上时才取消穿透
  petWin.setIgnoreMouseEvents(true, { forward: true });
}

function openSettings() {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 580,
    height: 800,
    title: '桌宠设置',
    autoHideMenuBar: true,
    backgroundColor: '#f4f6fa',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.loadURL(baseURL + '/static/settings.html');
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}

function broadcast(channel, payload) {
  for (const w of [petWin, settingsWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function startWalkLoop() {
  setInterval(() => {
    if (!petWin || petWin.isDestroyed()) return;
    if (!petState.walking || petState.dragging || petState.chatActive || petState.oneShot) return;
    const cfg = config.get();
    const [x, y] = petWin.getPosition();
    const step = Math.max(1, Math.round((Number(cfg.model.speed) || 90) * WALK_TICK / 1000));
    let nx = x + walkDir * step;
    const b = screen.getPrimaryDisplay().bounds;
    if (nx <= b.x) { nx = b.x; flipWalk(1); }
    else if (nx + PET_W >= b.x + b.width) { nx = b.x + b.width - PET_W; flipWalk(-1); }
    petWin.setPosition(...clampPetPos(nx, y));
  }, WALK_TICK);
}

function flipWalk(dir) {
  walkDir = dir;
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('walk:dir', dir);
}

function registerIpc() {
  ipcMain.handle('config:get', () => config.get());
  ipcMain.handle('config:save', (e, partial) => {
    const cfg = config.save(partial);
    broadcast('config:changed', cfg);
    return cfg;
  });
  ipcMain.handle('config:reset', () => {
    const cfg = config.reset();
    broadcast('config:changed', cfg);
    return cfg;
  });

  ipcMain.on('anim:playOnce', (e, name) => {
    if (petWin && !petWin.isDestroyed()) petWin.webContents.send('anim:play', String(name || ''));
  });

  ipcMain.handle('model:getAnims', () => animNames);
  ipcMain.on('model:anims', (e, names) => {
    animNames = Array.isArray(names) ? names : [];
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.webContents.send('model:anims-changed', animNames);
    }
  });

  ipcMain.on('settings:open', openSettings);
  ipcMain.on('settings:close', () => { if (settingsWin) settingsWin.close(); });
  ipcMain.on('app:quit', () => app.quit());

  ipcMain.on('pet:interactive', (e, flag) => {
    if (petWin && !petWin.isDestroyed()) petWin.setIgnoreMouseEvents(!flag, { forward: true });
  });
  ipcMain.on('pet:state', (e, partial) => Object.assign(petState, partial || {}));

  ipcMain.on('win:dragStart', () => { petState.dragging = true; });
  ipcMain.on('win:dragMove', (e, dx, dy) => {
    if (!petWin || petWin.isDestroyed()) return;
    const [x, y] = petWin.getPosition();
    petWin.setPosition(...clampPetPos(x + Math.round(dx), y + Math.round(dy)));
  });
  ipcMain.on('win:dragEnd', () => { petState.dragging = false; });

  ipcMain.handle('llm:chat', (e, messages) => {
    const id = llm.nextId();
    llm.chat({ cfg: config.get(), messages: messages || [], win: petWin, id });
    return id;
  });
  ipcMain.handle('llm:test', () => llm.test(config.get()));
  ipcMain.on('llm:abort', () => llm.abortAll());
  ipcMain.on('chat:clear', () => {
    if (petWin && !petWin.isDestroyed()) petWin.webContents.send('chat:cleared');
  });
}

app.whenReady().then(async () => {
  config.load();
  const srv = await createServer(app.getAppPath());
  baseURL = srv.url;
  registerIpc();
  createPetWindow();
  startWalkLoop();
});

app.on('window-all-closed', () => {
  app.quit();
});
