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
      speed: 90,          // 走路速度 px/s
      randomMinSec: 6,    // 随机动作最小间隔（秒）
      randomMaxSec: 15,   // 随机动作最大间隔（秒）
      action: 'Default'   // 当前动作：动画名，'random' 为随机动作
    },
    bubble: {
      bg: '#ffffff',
      color: '#333333',
      opacity: 0.92,
      fontSize: 15,
      width: 440,         // 气泡宽度 px（260 ~ 460）
      height: 160,        // 消息区最大高度 px（100 ~ 400）
      gapPercent: 17,     // 气泡底边距模型顶部的距离（模型高度的百分比，0 ~ 60；17 ≈ 1/6）
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

// 数值字段兜底钳制（防手改 config.json 出非法值）
function sanitize() {
  const b = cfg.bubble;
  b.width = Math.min(460, Math.max(260, Number(b.width) || 440));
  b.height = Math.min(400, Math.max(100, Number(b.height) || 160));
  b.gapPercent = Math.min(60, Math.max(0, Number(b.gapPercent ?? 17)));
}

function load() {
  cfg = defaults();
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(file(), 'utf-8'));
  } catch (e) {
    raw = null;
  }
  if (raw) deepMerge(cfg, raw);
  // 迁移 v1.1.0 之前的结构：mode(idle/walk/lie/random) + anims 映射 → action
  if (raw && raw.model && raw.model.mode && !raw.model.action) {
    const m = raw.model.mode;
    const a = raw.model.anims || {};
    if (m === 'random') cfg.model.action = 'random';
    else if (m === 'walk' && a.walk) cfg.model.action = a.walk;
    else if (m === 'lie' && a.lie) cfg.model.action = a.lie;
    else if (a.idle) cfg.model.action = a.idle;
  }
  delete cfg.model.mode;
  delete cfg.model.anims;
  sanitize();
  return cfg;
}

function get() {
  if (!cfg) load();
  return cfg;
}

function save(partial) {
  if (!cfg) load();
  deepMerge(cfg, partial || {});
  sanitize();
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
