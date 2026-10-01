const { contextBridge, ipcRenderer } = require('electron');

const ON_CHANNELS = [
  'llm:chunk', 'llm:done', 'llm:error',
  'config:changed', 'walk:dir', 'model:anims-changed', 'chat:cleared'
];

contextBridge.exposeInMainWorld('pet', {
  // 配置
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (partial) => ipcRenderer.invoke('config:save', partial),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  // 模式与模型
  setMode: (mode) => ipcRenderer.invoke('mode:set', mode),
  reportAnims: (names) => ipcRenderer.send('model:anims', names),
  getAnims: () => ipcRenderer.invoke('model:getAnims'),
  // 窗口交互
  setInteractive: (flag) => ipcRenderer.send('pet:interactive', flag),
  setState: (partial) => ipcRenderer.send('pet:state', partial),
  dragStart: () => ipcRenderer.send('win:dragStart'),
  dragMove: (dx, dy) => ipcRenderer.send('win:dragMove', dx, dy),
  dragEnd: () => ipcRenderer.send('win:dragEnd'),
  // 菜单 / 设置窗口 / 退出
  openSettings: () => ipcRenderer.send('settings:open'),
  closeSettings: () => ipcRenderer.send('settings:close'),
  quitApp: () => ipcRenderer.send('app:quit'),
  // 对话
  chat: (messages) => ipcRenderer.invoke('llm:chat', messages),
  chatTest: () => ipcRenderer.invoke('llm:test'),
  chatAbort: () => ipcRenderer.send('llm:abort'),
  clearChat: () => ipcRenderer.send('chat:clear'),
  // 事件订阅（白名单）
  on: (channel, cb) => {
    if (!ON_CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (e, data) => cb(data));
  }
});
