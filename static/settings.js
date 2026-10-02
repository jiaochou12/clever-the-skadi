/* 设置窗口逻辑：读取配置 → 填表单 → 保存应用 */
const $ = (id) => document.getElementById(id);

// 动画名汉化（未收录的动画显示原始英文名）
const ANIM_CN = {
  Default: '站立',
  Interact: '互动',
  Move: '走路',
  Relax: '放松',
  Sit: '坐下',
  Sleep: '睡觉',
  Special: '特殊'
};
const animLabel = (n) => ANIM_CN[n] || n;

const fields = {
  baseUrl: $('baseUrl'),
  apiKey: $('apiKey'),
  model: $('model'),
  systemPrompt: $('systemPrompt'),
  temperature: $('temperature'),
  action: $('action'),
  onceAnim: $('onceAnim'),
  randomMinSec: $('randomMinSec'),
  randomMaxSec: $('randomMaxSec'),
  speed: $('speed'),
  scale: $('scale'),
  bg: $('bg'),
  color: $('color'),
  bubbleWidth: $('bubbleWidth'),
  bubbleHeight: $('bubbleHeight'),
  gapPercent: $('gapPercent'),
  opacity: $('opacity'),
  fontSize: $('fontSize'),
  autoHideSec: $('autoHideSec')
};

function toast(text, ok = true) {
  const t = $('toast');
  t.textContent = text;
  t.style.background = ok ? '#3d9a6c' : '#c0574f';
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1800);
}

function fillValue(id, v) {
  if (fields[id]) fields[id].value = v;
}

function showVal(id, text) {
  const el = $(id + 'Val');
  if (el) el.textContent = text;
}

function fillOptions(sel, list) {
  sel.innerHTML = '';
  for (const n of list) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = animLabel(n);
    sel.appendChild(opt);
  }
}

// 填充动作下拉框：全部动画 + 随机动作
function fillActions(anims, current) {
  const list = anims && anims.length ? anims : [current === 'random' ? 'Default' : (current || 'Default')];
  fillOptions(fields.action, list);
  const ro = document.createElement('option');
  ro.value = 'random';
  ro.textContent = '随机动作';
  fields.action.appendChild(ro);
  const cur = current === 'random' ? 'random' : (list.includes(current) ? current : list[0]);
  fillValue('action', cur);
  fillOptions(fields.onceAnim, list);
  fillValue('onceAnim', list[0]);
}

async function load() {
  const cfg = await window.pet.getConfig();
  fillValue('baseUrl', cfg.api.baseUrl);
  fillValue('apiKey', cfg.api.apiKey);
  fillValue('model', cfg.api.model);
  fillValue('systemPrompt', cfg.api.systemPrompt);
  fillValue('temperature', cfg.api.temperature);
  showVal('temperature', cfg.api.temperature);

  fillValue('speed', cfg.model.speed);
  showVal('speed', cfg.model.speed + ' px/s');
  fillValue('scale', cfg.model.scale);
  showVal('scale', Math.round(cfg.model.scale * 100) + '%');
  fillValue('randomMinSec', cfg.model.randomMinSec);
  showVal('randomMinSec', cfg.model.randomMinSec + 's');
  fillValue('randomMaxSec', cfg.model.randomMaxSec);
  showVal('randomMaxSec', cfg.model.randomMaxSec + 's');
  fillActions(await window.pet.getAnims(), cfg.model.action);

  fillValue('bg', cfg.bubble.bg);
  fillValue('color', cfg.bubble.color);
  fillValue('bubbleWidth', cfg.bubble.width);
  showVal('bubbleWidth', cfg.bubble.width + 'px');
  fillValue('bubbleHeight', cfg.bubble.height);
  showVal('bubbleHeight', cfg.bubble.height + 'px');
  fillValue('gapPercent', cfg.bubble.gapPercent);
  showVal('gapPercent', cfg.bubble.gapPercent + '%');
  fillValue('opacity', Math.round(cfg.bubble.opacity * 100));
  showVal('opacity', Math.round(cfg.bubble.opacity * 100) + '%');
  fillValue('fontSize', cfg.bubble.fontSize);
  showVal('fontSize', cfg.bubble.fontSize + 'px');
  fillValue('autoHideSec', cfg.bubble.autoHideSec);
  showVal('autoHideSec', cfg.bubble.autoHideSec === 0 ? '不隐藏' : cfg.bubble.autoHideSec + 's');
  paintAllRanges();
}

function collect() {
  let lo = Number(fields.randomMinSec.value);
  let hi = Number(fields.randomMaxSec.value);
  if (hi < lo) [lo, hi] = [hi, lo];
  return {
    api: {
      baseUrl: fields.baseUrl.value.trim(),
      apiKey: fields.apiKey.value.trim(),
      model: fields.model.value.trim(),
      systemPrompt: fields.systemPrompt.value,
      temperature: Number(fields.temperature.value)
    },
    model: {
      action: fields.action.value,
      speed: Number(fields.speed.value),
      scale: Number(fields.scale.value),
      randomMinSec: lo,
      randomMaxSec: hi
    },
    bubble: {
      bg: fields.bg.value,
      color: fields.color.value,
      width: Number(fields.bubbleWidth.value),
      height: Number(fields.bubbleHeight.value),
      gapPercent: Number(fields.gapPercent.value),
      opacity: Number(fields.opacity.value) / 100,
      fontSize: Number(fields.fontSize.value),
      autoHideSec: Number(fields.autoHideSec.value)
    }
  };
}

// 滑块：轨道按当前值填充，数值实时显示
const RANGE_IDS = ['temperature', 'speed', 'scale', 'opacity', 'fontSize', 'autoHideSec', 'randomMinSec', 'randomMaxSec', 'bubbleWidth', 'bubbleHeight', 'gapPercent'];

function paintRange(id) {
  const el = fields[id];
  const min = Number(el.min) || 0;
  const max = Number(el.max) || 100;
  const pct = ((Number(el.value) - min) / (max - min)) * 100;
  el.style.background =
    `linear-gradient(to right, #6c8fb5 0% ${pct}%, #e6e9ee ${pct}% 100%)`;
}

function paintAllRanges() {
  for (const id of RANGE_IDS) paintRange(id);
}

for (const id of RANGE_IDS) {
  fields[id].addEventListener('input', () => {
    const v = Number(fields[id].value);
    if (id === 'speed') showVal(id, v + ' px/s');
    else if (id === 'scale') showVal(id, Math.round(v * 100) + '%');
    else if (id === 'opacity') showVal(id, v + '%');
    else if (id === 'fontSize' || id === 'bubbleWidth' || id === 'bubbleHeight') showVal(id, v + 'px');
    else if (id === 'gapPercent') showVal(id, v + '%');
    else if (id === 'autoHideSec') showVal(id, v === 0 ? '不隐藏' : v + 's');
    else if (id === 'randomMinSec' || id === 'randomMaxSec') showVal(id, v + 's');
    else showVal(id, v);
    paintRange(id);
  });
}

$('eye').addEventListener('click', () => {
  const hidden = fields.apiKey.type === 'password';
  fields.apiKey.type = hidden ? 'text' : 'password';
  $('eye').textContent = hidden ? '隐藏' : '显示';
});

$('playOnceBtn').addEventListener('click', () => {
  const name = fields.onceAnim.value;
  if (name) window.pet.playAnim(name);
});

$('testBtn').addEventListener('click', async () => {
  const el = $('testResult');
  el.textContent = '测试中…';
  el.style.color = '#8a919c';
  // 先保存当前 API 设置再测试，保证测试的是表单里的值
  await window.pet.saveConfig(collect());
  const r = await window.pet.chatTest();
  el.textContent = r.message || (r.ok ? '成功' : '失败');
  el.style.color = r.ok ? '#3d9a6c' : '#c0574f';
});

async function save() {
  await window.pet.saveConfig(collect());
  toast('已保存并应用');
}

$('saveBtn').addEventListener('click', save);

$('closeBtn').addEventListener('click', () => window.pet.closeSettings());

$('recallBtn').addEventListener('click', () => {
  window.pet.recallPet();
  toast('已把桌宠移回主屏幕右下角');
});

$('clearBtn').addEventListener('click', () => {
  window.pet.clearChat();
  toast('已清空桌宠的对话记录');
});

$('resetBtn').addEventListener('click', async () => {
  if (!confirm('确定恢复全部默认设置？（API 填写内容也会被清空）')) return;
  await window.pet.resetConfig();
  await load();
  toast('已恢复默认设置');
});

// 主进程推送：模型动画列表解析完成后刷新下拉框
window.pet.on('model:anims-changed', async () => {
  const cfg = await window.pet.getConfig();
  fillActions(await window.pet.getAnims(), cfg.model.action);
});

// 桌宠端改了动作时同步表单
window.pet.on('config:changed', (cfg) => {
  if (!cfg) return;
  fillValue('action', cfg.model.action);
});

load();
