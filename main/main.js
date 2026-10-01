const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const config = require('./config');
const { createServer } = require('./server');
const llm = require('./llm');

let baseURL = '';
let petWin = null;
let settingsWin = null;
let animNames = [];               // 渲染进程加载模型后上报的动画列表
const petState = { dragging: false, chatActive: false };
let walkDir = 1;
const WALK_TICK = 33;

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
  petWin = new BrowserWindow({
    width: 480,
    height: 700,
    x: screen.getPrimaryDisplay().workArea.x + screen.getPrimaryDisplay().workArea.width - 500,
    y: screen.getPrimaryDisplay().workArea.y + screen.getPrimaryDisplay().workArea.height - 692,
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
    const cfg = config.get();
    if (cfg.model.mode !== 'walk' || petState.dragging || petState.chatActive) return;
    const [x, y] = petWin.getPosition();
    const { width: w } = petWin.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    const step = Math.max(1, Math.round((Number(cfg.model.speed) || 90) * WALK_TICK / 1000));
    let nx = x + walkDir * step;
    if (nx <= wa.x) { nx = wa.x; flipWalk(1); }
    else if (nx + w >= wa.x + wa.width) { nx = wa.x + wa.width - w; flipWalk(-1); }
    petWin.setPosition(nx, y);
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

  ipcMain.handle('mode:set', (e, mode) => {
    if (!['idle', 'walk', 'lie'].includes(mode)) return config.get();
    const cfg = config.save({ model: { mode } });
    broadcast('config:changed', cfg);
    return cfg;
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
    petWin.setPosition(x + Math.round(dx), y + Math.round(dy));
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
