const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_PERSONA =
  '你是斯卡蒂（Skadi），明日方舟中的深海猎人，性格沉稳温柔、寡言但可靠。' +
  '请用简短自然的口语回答，每次回复控制在 80 字以内，不要使用 Markdown 符号。';

function defaults() {
  return {
    api: {
      baseUrl: '',        // 例: https://api.openai.com/v1 或 https://api.deepseek.com/v1
      apiKey: '',
      model: '',
      systemPrompt: DEFAULT_PERSONA,
      temperature: 0.8
    },
    model: {
      scale: 1.0,         // 0.6 ~ 1.6
      mode: 'idle',       // idle | walk | lie | random
      speed: 90,          // 走路速度 px/s
      randomMinSec: 6,    // 随机动作最小间隔（秒）
      randomMaxSec: 15,   // 随机动作最大间隔（秒）
      anims: { idle: 'Default', walk: 'Move', lie: 'Sleep' }
    },
    bubble: {
      bg: '#ffffff',
      color: '#333333',
      opacity: 0.92,
      fontSize: 15,
      autoHideSec: 30     // 0 = 不自动隐藏
    }
  };
}

function deepMerge(target, src) {
  if (!src || typeof src !== 'object') return target;
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepMerge(target[k], v);
    } else if (v !== undefined) {
      target[k] = v;
    }
  }
  return target;
}

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

let cfg = null;

function load() {
  cfg = defaults();
  try {
    const raw = fs.readFileSync(file(), 'utf-8');
    deepMerge(cfg, JSON.parse(raw));
  } catch (e) {
    // 首次运行或文件损坏，使用默认值
  }
  return cfg;
}

function get() {
  if (!cfg) load();
  return cfg;
}

function save(partial) {
  if (!cfg) load();
  deepMerge(cfg, partial || {});
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {
    console.error('[config] save failed:', e.message);
  }
  return cfg;
}

function reset() {
  cfg = defaults();
  try { fs.writeFileSync(file(), JSON.stringify(cfg, null, 2), 'utf-8'); } catch (e) {}
  return cfg;
}

module.exports = { get, load, save, reset, defaults };
