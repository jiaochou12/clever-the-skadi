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

// 不做任何屏幕边界约束：桌宠可放置于屏幕外任意位置（走丢时可通过设置窗口“找回桌宠”召回）

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
  const ix = Math.round(wa.x + wa.width - PET_W - 20);
  const iy = Math.round(wa.y + wa.height - PET_H);
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
    icon: path.join(app.getAppPath(), 'build', 'icon.ico'),
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
    // 边界判断：用模型自身可见像素的屏幕绝对坐标（窗口位置 + 窗口内包围盒）
    // 对照模型所在屏幕的分辨率；到边即折返，本拍不再前进。多显示器按模型所在屏计算
    const mr = petState.modelRect;
    const b = screen.getDisplayNearestPoint({ x: x + Math.round(PET_W / 2), y: y + Math.round(PET_H / 2) }).bounds;
    if (mr && mr.w > 0) {
      const modelLeft = x + mr.x;
      const modelRight = x + mr.x + mr.w;
      if (walkDir > 0 && modelRight >= b.x + b.width) { flipWalk(-1); return; }
      if (walkDir < 0 && modelLeft <= b.x) { flipWalk(1); return; }
    } else {
      // 包围盒未上报时退回用窗口边界判断
      if (walkDir > 0 && x + PET_W >= b.x + b.width) { flipWalk(-1); return; }
      if (walkDir < 0 && x <= b.x) { flipWalk(1); return; }
    }
    petWin.setPosition(x + walkDir * step, y);
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
    llm.warm(cfg);   // 配置变更后预热连接，降低第一条消息首字延迟
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
    petWin.setPosition(x + Math.round(dx), y + Math.round(dy));
  });
  ipcMain.on('win:dragEnd', () => { petState.dragging = false; });

  // 找回桌宠：移回主屏幕工作区右下角
  ipcMain.on('win:recall', () => {
    if (!petWin || petWin.isDestroyed()) return;
    const wa = screen.getPrimaryDisplay().workArea;
    petWin.setPosition(Math.round(wa.x + wa.width - PET_W - 20), Math.round(wa.y + wa.height - PET_H));
    petWin.show();
    petWin.focus();
  });

  ipcMain.handle('llm:chat', (e, messages) => {
    const id = llm.nextId();
    llm.chat({ cfg: config.get(), messages: messages || [], win: petWin, id });
    return id;
  });
  ipcMain.handle('llm:test', () => llm.test(config.get()));
  ipcMain.on('llm:abort', () => llm.abortAll());
  ipcMain.on('llm:warm', () => llm.warm(config.get()));   // 渲染层打开气泡时预热连接
  ipcMain.on('chat:clear', () => {
    if (petWin && !petWin.isDestroyed()) petWin.webContents.send('chat:cleared');
  });
}

app.whenReady().then(async () => {
  config.load();
  llm.warm(config.get());   // 启动即预热：提前完成 DNS/TLS 握手
  const srv = await createServer(app.getAppPath());
  baseURL = srv.url;
  registerIpc();
  createPetWindow();
  startWalkLoop();
});

app.on('window-all-closed', () => {
  app.quit();
});
