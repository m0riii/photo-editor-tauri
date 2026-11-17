/* ویرایشگر عکس — فرانت‌اند (Canvas) — با Rust/Tauri یا مرورگر معمولی کار می‌کند.
   دستورهای سنگین پیکسلی (نور/رنگ، نویزگیری، تغییر اندازه، GIF) از Rust می‌آیند؛
   اگر Tauri در دسترس نباشد، نسخه جاوااسکریپتی همان کار را انجام می‌دهد. */
'use strict';

const $ = (id) => document.getElementById(id);
const mainCanvas = $('mainCanvas'), overlay = $('overlayCanvas');
const mctx = mainCanvas.getContext('2d'), octx = overlay.getContext('2d');
const canvasWrap = $('canvasWrap'), emptyHint = $('emptyHint');

/* ---------- وضعیت ---------- */
const work = document.createElement('canvas');          // لایه پایه (عکس اصلی)
const wctx = work.getContext('2d', { willReadFrequently: true });
let layers = [];        // {id,name,type,canvas,visible,opacity,x,y}
let activeLayerId = 'base';
let currentFileName = 'edited.png';
let currentTool = 'move';
let brushSize = 60, brushStrength = 50, brushColor = '#ff5a5a';
let zoom = 1, hasImage = false;
let history = [], hIndex = -1;
let isDrawing = false, lastPos = null, strokeSnapshot = null, cloneOffset = null;
let cropRect = null, cropStart = null, textPos = null, dragLayer = null;
let blurredCache = null, sharpenedCache = null, cacheFor = null;

/* ---------- فراخوانی Rust (Tauri) ---------- */
async function tauriInvoke(cmd, args) {
  const t = window.__TAURI_INTERNALS__;
  if (t && typeof t.invoke === 'function') return await t.invoke(cmd, args || {});
  throw new Error('Tauri در دسترس نیست');
}
async function hasTauri() {
  try { await tauriInvoke('get_app_info', {}); return true; } catch (e) { return false; }
}
function setMsg(msg) { $('statusMsg').textContent = msg || ''; }
function setToolLabel(name) { $('statusTool').textContent = 'ابزار: ' + name; }

/* ---------- تاریخچه (Undo/Redo) ---------- */
function snapshot() {
  return {
    base: work.toDataURL('image/png'),
    layers: layers.map(l => ({ id: l.id, name: l.name, type: l.type, visible: l.visible,
      opacity: l.opacity, x: l.x, y: l.y, data: l.canvas.toDataURL('image/png') })),
  };
}
function pushHistory() {
  history = history.slice(0, hIndex + 1);
  history.push(snapshot());
  if (history.length > 25) history.shift();
  hIndex = history.length - 1;
  updateUndoButtons();
}
function updateUndoButtons() {
  $('btnUndo').disabled = hIndex <= 0;
  $('btnRedo').disabled = hIndex >= history.length - 1;
}
async function restoreSnapshot(snap) {
  const img = await loadImage(snap.base);
  work.width = img.width; work.height = img.height;
  wctx.clearRect(0, 0, work.width, work.height);
  wctx.drawImage(img, 0, 0);
  layers = [];
  for (const l of snap.layers) {
    const li = await loadImage(l.data);
    const c = document.createElement('canvas');
    c.width = li.width; c.height = li.height;
    c.getContext('2d').drawImage(li, 0, 0);
    layers.push({ id: l.id, name: l.name, type: l.type, canvas: c, visible: l.visible,
      opacity: l.opacity, x: l.x, y: l.y });
  }
  activeLayerId = 'base';
  renderLayersList(); render();
}
async function undo() {
  if (hIndex <= 0) return;
  hIndex--; await restoreSnapshot(history[hIndex]); updateUndoButtons(); setMsg('واگرد انجام شد');
}
async function redo() {
  if (hIndex >= history.length - 1) return;
  hIndex++; await restoreSnapshot(history[hIndex]); updateUndoButtons(); setMsg('از نو انجام شد');
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('بارگذاری عکس ناموفق بود'));
    img.src = src;
  });
}

/* ---------- رندر ---------- */
function fitZoom() {
  if (!hasImage) return 1;
  const r = canvasWrap.getBoundingClientRect();
  return Math.min((r.width - 40) / work.width, (r.height - 40) / work.height, 1.5);
}
function render() {
  if (!hasImage) { emptyHint.style.display = 'flex'; return; }
  emptyHint.style.display = 'none';
  const dw = Math.max(1, Math.round(work.width * zoom));
  const dh = Math.max(1, Math.round(work.height * zoom));
  mainCanvas.width = dw; mainCanvas.height = dh;
  overlay.width = dw; overlay.height = dh;
  mainCanvas.style.width = dw + 'px'; mainCanvas.style.height = dh + 'px';
  overlay.style.width = dw + 'px'; overlay.style.height = dh + 'px';
  mctx.clearRect(0, 0, dw, dh);
  mctx.imageSmoothingQuality = 'high';
  mctx.drawImage(work, 0, 0, dw, dh);
  for (const l of layers) {
    if (!l.visible) continue;
    mctx.save();
    mctx.globalAlpha = l.opacity;
    mctx.drawImage(l.canvas, l.x * zoom, l.y * zoom, l.canvas.width * zoom, l.canvas.height * zoom);
    mctx.restore();
  }
  $('zoomLabel').textContent = Math.round(zoom * 100) + '٪';
  $('statusSize').textContent = work.width + ' × ' + work.height + ' پیکسل' +
    (layers.length ? ' • ' + layers.length + ' لایه' : '');
}
function setZoom(z, fit) {
  if (!hasImage) return;
  zoom = fit ? fitZoom() : Math.min(3, Math.max(0.1, z));
  render();
}
function flattenToCanvas() {
  const c = document.createElement('canvas');
  c.width = work.width; c.height = work.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(work, 0, 0);
  for (const l of layers) {
    if (!l.visible) continue;
    ctx.save(); ctx.globalAlpha = l.opacity;
    ctx.drawImage(l.canvas, l.x, l.y); ctx.restore();
  }
  return c;
}
function flattenIntoBase() {
  const flat = flattenToCanvas();
  work.width = flat.width; work.height = flat.height;
  wctx.clearRect(0, 0, work.width, work.height);
  wctx.drawImage(flat, 0, 0);
  layers = []; activeLayerId = 'base'; renderLayersList();
}

/* ---------- باز کردن / ذخیره ---------- */
async function loadFromDataURL(dataUrl, name) {
  const img = await loadImage(dataUrl);
  work.width = img.width; work.height = img.height;
  wctx.clearRect(0, 0, work.width, work.height);
  wctx.drawImage(img, 0, 0);
  layers = []; activeLayerId = 'base';
  hasImage = true;
  currentFileName = name || 'edited.png';
  $('resizeW').value = img.width; $('resizeH').value = img.height;
  history = []; hIndex = -1;
  pushHistory();
  setZoom(0, true);
  renderLayersList();
  setMsg('عکس باز شد: ' + currentFileName);
}
async function openViaTauri() {
  const path = await tauriInvoke('open_image_dialog', {});
  if (!path) return 'cancelled'; // کاربر دیالوگ را بست؛ فایل‌پیِکر مرورگر باز نشود
  const dataUrl = await tauriInvoke('read_image_as_data_url', { path });
  const name = path.split(/[\\/]/).pop() || 'edited.png';
  await loadFromDataURL(dataUrl, name);
  return true;
}
function openViaFileInput() { $('fileInput').click(); }
async function openImage() {
  try {
    const r = await openViaTauri();
    if (r === true || r === 'cancelled') return; // در Tauri هستیم؛ لغو یعنی هیچ‌کاری نکن
  } catch (e) { /* Tauri نیست؛ به ورودی فایل برمی‌گردیم */ }
  openViaFileInput();
}
function compositeDataURL(format) {
  const flat = flattenToCanvas();
  if (format === 'jpg' || format === 'jpeg') return flat.toDataURL('image/jpeg', 0.92);
  if (format === 'bmp') return flat.toDataURL('image/png'); // BMP در مرورگر encoder ندارد؛ PNG ذخیره می‌شود
  return flat.toDataURL('image/png');
}
function downloadDataURL(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}
function baseName(name) { return name.replace(/\.[^.]+$/, '') || 'edited'; }
async function saveAs() {
  if (!hasImage) { setMsg('اول یک عکس باز کنید'); return; }
  const format = (currentFileName.split('.').pop() || 'png').toLowerCase();
  let dataUrl = compositeDataURL(format);
  const outName = baseName(currentFileName) + '.' + (format === 'jpeg' ? 'jpg' : format);
  try {
    if (format === 'gif' || format === 'bmp') {
      // تبدیل واقعی فرمت با Rust (image crate) — قبلاً PNG با پسوند bmp ذخیره می‌شد
      dataUrl = await tauriInvoke('convert_image_format', { dataUrl, format });
    }
    const path = await tauriInvoke('save_image_dialog', { defaultName: outName });
    if (!path) return;
    await tauriInvoke('save_image_data_url', { path, dataUrl });
    setMsg('ذخیره شد: ' + path);
  } catch (e) {
    if (format === 'bmp' || format === 'gif') {
      // در پیش‌نمایش مرورگر encoder برای BMP/GIF نیست؛ PNG ذخیره می‌شود
      downloadDataURL(dataUrl, baseName(currentFileName) + '.png');
      setMsg('در مرورگر BMP/GIF پشتیبانی نمی‌شود؛ نسخه PNG دانلود شد');
    } else {
      downloadDataURL(dataUrl, outName);
      setMsg('دانلود شد: ' + outName);
    }
  }
}
async function saveQuick() {
  if (!hasImage) { setMsg('اول یک عکس باز کنید'); return; }
  await saveAs();
}

/* ---------- لایه‌ها ---------- */
let layerSeq = 0;
function addLayer(name, type, canvas, x, y) {
  const l = { id: 'l' + (++layerSeq) + '_' + Date.now(), name, type,
    canvas, visible: true, opacity: 1, x: x || 0, y: y || 0 };
  layers.push(l); activeLayerId = l.id;
  renderLayersList(); render();
  return l;
}
function activeTarget() {
  if (activeLayerId === 'base') return { ctx: wctx, canvas: work };
  const l = layers.find(x => x.id === activeLayerId);
  return l ? { ctx: l.canvas.getContext('2d'), canvas: l.canvas } : { ctx: wctx, canvas: work };
}
function renderLayersList() {
  const box = $('layersList');
  box.innerHTML = '';
  const mk = (name, id, extra) => {
    const d = document.createElement('div');
    d.className = 'layer-item' + (activeLayerId === id ? ' active' : '');
    d.innerHTML = '<span class="nm"></span>';
    d.querySelector('.nm').textContent = name;
    d.onclick = () => { activeLayerId = id; renderLayersList(); render(); };
    if (extra) {
      const b = document.createElement('button'); b.textContent = extra.label; b.title = extra.title;
      b.onclick = (e) => { e.stopPropagation(); extra.fn(); };
      d.appendChild(b);
    }
    box.appendChild(d);
  };
  mk('🖼️ لایه پایه (عکس)', 'base');
  layers.forEach(l => mk((l.visible ? '👁 ' : '🚫 ') + l.name, l.id, {
    label: '✕', title: 'حذف لایه',
    fn: () => { layers = layers.filter(x => x.id !== l.id); activeLayerId = 'base'; pushHistory(); renderLayersList(); render(); },
  }));
  if (!layers.length) {
    const p = document.createElement('p'); p.className = 'tip';
    p.textContent = 'هنوز لایه‌ای نیست — متن یا عکس روی هم اضافه کنید.';
    box.appendChild(p);
  }
}

/* ---------- ابزارهای قلمی ---------- */
function toImagePos(e) {
  const r = mainCanvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
}
function softMaskCanvas(r) {
  const c = document.createElement('canvas');
  c.width = c.height = Math.max(2, Math.ceil(r * 2));
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
  return c;
}
function paintFrom(sourceCanvas, srcPos, dstPos, alpha) {
  // srcPos: مرکز ناحیه منبع؛ dstPos: مرکز ناحیه مقصد (برای کلون متفاوت‌اند)
  if (dstPos === undefined) { dstPos = srcPos; }
  const t = activeTarget();
  const r = brushSize / 2;
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = Math.ceil(r * 2);
  const tctx = tmp.getContext('2d');
  tctx.drawImage(sourceCanvas, srcPos.x - r, srcPos.y - r, r * 2, r * 2, 0, 0, r * 2, r * 2);
  tctx.globalCompositeOperation = 'destination-in';
  tctx.drawImage(softMaskCanvas(r), 0, 0);
  t.ctx.save(); t.ctx.globalAlpha = alpha; t.ctx.drawImage(tmp, dstPos.x - r, dstPos.y - r); t.ctx.restore();
}
function blurredCopyOf(canvas, blurPx) {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.filter = 'blur(' + blurPx + 'px)';
  ctx.drawImage(canvas, 0, 0);
  return c;
}
function sharpenedCopyOf(canvas) {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.filter = 'contrast(1.6) saturate(1.3)';
  ctx.drawImage(canvas, 0, 0);
  return c;
}
function ensureDerived() {
  const t = activeTarget();
  const key = t.canvas.width + 'x' + t.canvas.height + ':' + (t.canvas === work ? 'b' : activeLayerId);
  if (cacheFor === key && blurredCache) return;
  cacheFor = key;
  blurredCache = blurredCopyOf(t.canvas, 9);
  sharpenedCache = sharpenedCopyOf(t.canvas);
}
function paintBrushStroke(pos, prev) {
  const a = brushStrength / 100;
  const t = activeTarget();
  const r = brushSize / 2;
  const pts = prev ? interpolate(prev, pos, Math.max(1, r / 3)) : [pos];
  for (const p of pts) {
    if (currentTool === 'skin' || currentTool === 'blurBrush') {
      ensureDerived();
      paintFrom(blurredCache, p, currentTool === 'skin' ? a * 0.85 : a);
    } else if (currentTool === 'sharpenBrush') {
      ensureDerived();
      paintFrom(sharpenedCache, p, a);
    } else if (currentTool === 'heal' || currentTool === 'object') {
      healAt(p, currentTool === 'object' ? 1.6 : 1);
    } else if (currentTool === 'clone') {
      if (!cloneOffset) { setMsg('برای کلون اول Alt + کلیک کنید تا منبع انتخاب شود'); return; }
      // منبع را از snapshot ابتدای ضربه می‌خوانیم تا نقاشی، منبع را خراب نکند
      const srcCanvas = strokeSnapshot || t.canvas;
      paintFrom(srcCanvas, { x: p.x + cloneOffset.dx, y: p.y + cloneOffset.dy }, p, a);
    } else if (currentTool === 'smudge') {
      smudgeAt(p, prev || p);
    } else if (currentTool === 'dodge' || currentTool === 'burn') {
      const g = t.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      const col = currentTool === 'dodge' ? '255,255,255' : '0,0,0';
      g.addColorStop(0, 'rgba(' + col + ',' + (a * 0.55) + ')');
      g.addColorStop(1, 'rgba(' + col + ',0)');
      t.ctx.save(); t.ctx.globalCompositeOperation = 'soft-light';
      t.ctx.fillStyle = g;
      t.ctx.beginPath(); t.ctx.arc(p.x, p.y, r, 0, Math.PI * 2); t.ctx.fill();
      t.ctx.restore();
    } else if (currentTool === 'colorize') {
      const g = t.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, hexA(brushColor, a * 0.8));
      g.addColorStop(1, hexA(brushColor, 0));
      t.ctx.save(); t.ctx.globalCompositeOperation = 'color';
      t.ctx.fillStyle = g;
      t.ctx.beginPath(); t.ctx.arc(p.x, p.y, r, 0, Math.PI * 2); t.ctx.fill();
      t.ctx.restore();
    }
  }
}
function interpolate(a, b, step) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(d / step));
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n });
  return out;
}
function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
}
function healAt(pos, scale) {
  const t = activeTarget();
  const r = (brushSize / 2) * scale;
  const src = { x: pos.x + r * 1.4, y: pos.y - r * 0.8 };
  const srcCanvas = strokeSnapshot || t.canvas;
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = Math.ceil(r * 2);
  const tctx = tmp.getContext('2d');
  tctx.drawImage(srcCanvas, src.x - r, src.y - r, r * 2, r * 2, 0, 0, r * 2, r * 2);
  tctx.filter = 'blur(2px)';
  tctx.drawImage(tmp, 0, 0);
  tctx.globalCompositeOperation = 'destination-in';
  tctx.drawImage(softMaskCanvas(r), 0, 0);
  t.ctx.save(); t.ctx.globalAlpha = 0.9; t.ctx.drawImage(tmp, pos.x - r, pos.y - r); t.ctx.restore();
}
function smudgeAt(pos, prev) {
  const t = activeTarget();
  const r = brushSize / 2;
  const dx = pos.x - prev.x, dy = pos.y - prev.y;
  if (!dx && !dy) return;
  const src = strokeSnapshot || t.canvas;
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = Math.ceil(r * 2);
  const tctx = tmp.getContext('2d');
  tctx.drawImage(src, pos.x - r - dx * 0.6, pos.y - r - dy * 0.6, r * 2, r * 2, 0, 0, r * 2, r * 2);
  tctx.globalCompositeOperation = 'destination-in';
  tctx.drawImage(softMaskCanvas(r), 0, 0);
  t.ctx.save(); t.ctx.globalAlpha = (brushStrength / 100) * 0.7;
  t.ctx.drawImage(tmp, pos.x - r, pos.y - r); t.ctx.restore();
}
function liquifyAt(pos, prev) {
  const t = activeTarget();
  const r = brushSize / 2;
  const dx = (pos.x - prev.x) * 0.6, dy = (pos.y - prev.y) * 0.6;
  if (!dx && !dy) return;
  const src = strokeSnapshot || t.canvas;
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = Math.ceil(r * 2);
  const tctx = tmp.getContext('2d');
  tctx.drawImage(src, pos.x - r, pos.y - r, r * 2, r * 2, 0, 0, r * 2, r * 2);
  tctx.globalCompositeOperation = 'destination-in';
  tctx.drawImage(softMaskCanvas(r), 0, 0);
  // ناحیه را با محتوای اصلی پر می‌کنیم تا حفره نماند، بعد نسخه جابه‌جا را می‌کشیم
  t.ctx.save();
  t.ctx.drawImage(tmp, pos.x - r + dx, pos.y - r + dy);
  t.ctx.restore();
  blurredCache = null; sharpenedCache = null; cacheFor = null;
}
function redeyeAt(pos) {
  const t = activeTarget();
  const r = brushSize / 2;
  const x0 = Math.max(0, Math.floor(pos.x - r)), y0 = Math.max(0, Math.floor(pos.y - r));
  const w = Math.min(t.canvas.width - x0, Math.ceil(r * 2)), h = Math.min(t.canvas.height - y0, Math.ceil(r * 2));
  if (w <= 0 || h <= 0) return;
  const img = t.ctx.getImageData(x0, y0, w, h);
  const d = img.data;
  let fixed = 0;
  for (let i = 0; i < d.length; i += 4) {
    const R = d[i], G = d[i + 1], B = d[i + 2];
    if (R > 90 && R > G + 35 && R > B + 35) {
      const v = Math.round((G + B) / 2 * 0.85);
      d[i] = v; d[i + 1] = Math.round(G * 0.85); d[i + 2] = Math.round(B * 0.85);
      fixed++;
    }
  }
  t.ctx.putImageData(img, x0, y0);
  setMsg(fixed ? 'چشم قرمز اصلاح شد (' + fixed + ' پیکسل)' : 'پیکسل قرمز در این ناحیه پیدا نشد — اندازه قلم را کوچک‌تر کنید');
}

/* ---------- برش و متن ---------- */
function drawOverlay() {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (cropRect) {
    const x = cropRect.x * zoom, y = cropRect.y * zoom, w = cropRect.w * zoom, h = cropRect.h * zoom;
    octx.save();
    octx.fillStyle = 'rgba(0,0,0,0.45)';
    octx.fillRect(0, 0, overlay.width, overlay.height);
    octx.clearRect(x, y, w, h);
    octx.strokeStyle = '#e0533d'; octx.lineWidth = 2;
    octx.strokeRect(x, y, w, h);
    octx.restore();
  }
  if (textPos) {
    octx.save();
    octx.font = $('textSize').value + 'px ' + $('textFont').value;
    octx.fillStyle = $('textColor').value;
    octx.globalAlpha = 0.85;
    octx.fillText($('textInput').value || '', textPos.x * zoom, textPos.y * zoom);
    octx.restore();
  }
}
function applyCrop() {
  if (!cropRect || cropRect.w < 4 || cropRect.h < 4) { setMsg('اول با ابزار برش یک مستطیل بکشید'); return; }
  const x = Math.max(0, Math.round(cropRect.x)), y = Math.max(0, Math.round(cropRect.y));
  const w = Math.min(work.width - x, Math.round(cropRect.w)), h = Math.min(work.height - y, Math.round(cropRect.h));
  const nc = document.createElement('canvas'); nc.width = w; nc.height = h;
  nc.getContext('2d').drawImage(work, x, y, w, h, 0, 0, w, h);
  work.width = w; work.height = h;
  wctx.clearRect(0, 0, w, h); wctx.drawImage(nc, 0, 0);
  for (const l of layers) {
    const lc = document.createElement('canvas'); lc.width = w; lc.height = h;
    lc.getContext('2d').drawImage(l.canvas, x - l.x, y - l.y, w, h, 0, 0, w, h);
    l.canvas = lc; l.x = 0; l.y = 0;
  }
  cropRect = null; drawOverlay();
  pushHistory(); setZoom(0, true); render();
  setMsg('برش اعمال شد');
}
function applyTextLayer() {
  if (!hasImage) { setMsg('اول یک عکس باز کنید'); return; }
  const text = $('textInput').value.trim();
  if (!text) { setMsg('متن را بنویسید'); return; }
  const size = parseInt($('textSize').value, 10) || 48;
  const c = document.createElement('canvas');
  c.width = work.width; c.height = work.height;
  const ctx = c.getContext('2d');
  ctx.font = size + 'px ' + $('textFont').value;
  ctx.fillStyle = $('textColor').value;
  ctx.textBaseline = 'top';
  const pos = textPos || { x: work.width / 4, y: work.height / 4 };
  ctx.fillText(text, pos.x, pos.y);
  addLayer('متن: ' + text.slice(0, 20), 'text', c, 0, 0);
  textPos = null; drawOverlay();
  pushHistory();
  setMsg('متن به‌عنوان لایه اضافه شد — با ابزار جابه‌جا می‌توانید آن را بکشید');
}

/* ---------- تنظیم نور/رنگ (Rust + جایگزین JS) ---------- */
function adjValues() {
  return {
    brightness: +$('adjBright').value, contrast: +$('adjContrast').value,
    saturation: +$('adjSat').value, warmth: +$('adjWarm').value,
    hue: +($('adjHue') ? $('adjHue').value : 0),
    blur: +$('adjBlur').value, sharpen: +$('adjSharp').value,
  };
}
function cssPreviewFilter() {
  const v = adjValues();
  return 'brightness(' + (1 + v.brightness / 100) + ') contrast(' + (1 + v.contrast / 100) +
    ') saturate(' + (1 + v.saturation / 100) + ') hue-rotate(' + v.hue + 'deg)' +
    (v.blur > 0 ? ' blur(' + (v.blur / 2) + 'px)' : '');
}
function updateAdjustLabels() {
  const v = adjValues();
  $('vBright').textContent = v.brightness; $('vContrast').textContent = v.contrast;
  $('vSat').textContent = v.saturation; $('vWarm').textContent = v.warmth;
  $('vBlur').textContent = v.blur; $('vSharp').textContent = v.sharpen;
  const hueEl = $('vHue'); if (hueEl) hueEl.textContent = v.hue + '°';
  mainCanvas.style.filter = cssPreviewFilter();
}
function resetAdjustSliders() {
  ['adjBright', 'adjContrast', 'adjSat', 'adjWarm', 'adjBlur', 'adjSharp'].forEach(id => { $(id).value = 0; });
  if ($('adjHue')) $('adjHue').value = 0;
  mainCanvas.style.filter = '';
  updateAdjustLabels();
}
function jsAdjustPixels(dataUrl, v) {
  return loadImage(dataUrl).then(img => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const im = ctx.getImageData(0, 0, c.width, c.height);
    const d = im.data;
    const cc = v.contrast * 2.55;
    const factor = (259 * (cc + 255)) / (255 * (259 - cc));
    const sat = 1 + v.saturation / 100, add = v.brightness * 1.27, warm = v.warmth * 0.6;
    const hueRad = (v.hue || 0) * Math.PI / 180, cosA = Math.cos(hueRad), sinA = Math.sin(hueRad);
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i] + add, g = d[i + 1] + add, b = d[i + 2] + add;
      r = factor * (r - 128) + 128; g = factor * (g - 128) + 128; b = factor * (b - 128) + 128;
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * sat; g = gray + (g - gray) * sat; b = gray + (b - gray) * sat;
      r += warm; b -= warm;
      if (v.hue) {
        const nr = (0.299 + 0.701 * cosA + 0.168 * sinA) * r + (0.587 - 0.587 * cosA + 0.168 * sinA) * g + (0.114 - 0.114 * cosA - 0.497 * sinA) * b;
        const ng = (0.299 - 0.299 * cosA - 0.328 * sinA) * r + (0.587 + 0.413 * cosA + 0.064 * sinA) * g + (0.114 - 0.114 * cosA + 0.497 * sinA) * b;
        const nb = (0.299 - 0.299 * cosA + 0.559 * sinA) * r + (0.587 - 0.587 * cosA - 0.330 * sinA) * g + (0.114 + 0.886 * cosA - 0.168 * sinA) * b;
        r = nr; g = ng; b = nb;
      }
      d[i] = Math.max(0, Math.min(255, r)); d[i + 1] = Math.max(0, Math.min(255, g)); d[i + 2] = Math.max(0, Math.min(255, b));
    }
    ctx.putImageData(im, 0, 0);
    if (v.blur > 0.2) {
      const bc = blurredCopyOf(c, v.blur * 2);
      ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(bc, 0, 0);
    }
    if (v.sharpen > 1) {
      const sc = sharpenedCopyOf(c);
      ctx.globalAlpha = v.sharpen / 100; ctx.drawImage(sc, 0, 0); ctx.globalAlpha = 1;
    }
    return c.toDataURL('image/png');
  });
}
async function applyAdjust() {
  if (!hasImage) { setMsg('اول یک عکس باز کنید'); return; }
  const v = adjValues();
  setMsg('در حال اعمال با Rust…');
  try {
    const flat = flattenToCanvas().toDataURL('image/png');
    let out;
    try {
      out = await tauriInvoke('adjust_image', {
        dataUrl: flat, brightness: v.brightness, contrast: v.contrast,
        saturation: v.saturation, warmth: v.warmth, hue: v.hue, blur: v.blur, sharpen: v.sharpen,
      });
    } catch (e) { out = await jsAdjustPixels(flat, v); }
    flattenIntoBase();
    await loadFromDataURLKeepHistory(out);
    mainCanvas.style.filter = '';
    resetAdjustSliders();
    setMsg('تنظیم نور و رنگ اعمال شد');
  } catch (e) { setMsg('خطا در اعمال تنظیمات: ' + e.message); }
}
// بارگذاری نتیجه روی لایه پایه بدون پاک کردن تاریخچه‌ی قبل، بعد pushHistory
async function loadFromDataURLKeepHistory(dataUrl) {
  const img = await loadImage(dataUrl);
  work.width = img.width; work.height = img.height;
  wctx.clearRect(0, 0, work.width, work.height);
  wctx.drawImage(img, 0, 0);
  pushHistory(); render();
}
async function applyLevels() {
  if (!hasImage) return;
  const black = +$('lvlBlack').value, white = +$('lvlWhite').value;
  if (white <= black) { setMsg('نقطه سفید باید بزرگ‌تر از نقطه سیاه باشد'); return; }
  const flat = flattenToCanvas();
  const ctx = flat.getContext('2d', { willReadFrequently: true });
  const im = ctx.getImageData(0, 0, flat.width, flat.height);
  const d = im.data, range = white - black;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.max(0, Math.min(255, (d[i] - black) * 255 / range));
    d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] - black) * 255 / range));
    d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] - black) * 255 / range));
  }
  ctx.putImageData(im, 0, 0);
  flattenIntoBase();
  const img = await loadImage(flat.toDataURL('image/png'));
  work.width = img.width; work.height = img.height;
  wctx.drawImage(img, 0, 0);
  pushHistory(); render(); setMsg('سطوح رنگ اعمال شد');
}
async function applyGlow() {
  if (!hasImage) return;
  const amt = +$('glowAmt').value;
  if (amt <= 0) { setMsg('مقدار درخشش را بیشتر کنید'); return; }
  flattenIntoBase();
  const glow = blurredCopyOf(work, 12);
  wctx.save(); wctx.globalCompositeOperation = 'screen';
  wctx.globalAlpha = amt / 100 * 0.7; wctx.drawImage(glow, 0, 0); wctx.restore();
  pushHistory(); render(); setMsg('درخشش اعمال شد');
}
async function applyDenoise() {
  if (!hasImage) return;
  setMsg('در حال نویزگیری با Rust…');
  try {
    const flat = flattenToCanvas().toDataURL('image/png');
    let out;
    try { out = await tauriInvoke('denoise_image', { dataUrl: flat, strength: 60 }); }
    catch (e) { out = await jsAdjustPixels(flat, { brightness: 0, contrast: 0, saturation: 0, warmth: 0, hue: 0, blur: 1.5, sharpen: 0 }); }
    flattenIntoBase();
    await loadFromDataURLKeepHistory(out);
    setMsg('نویزگیری انجام شد');
  } catch (e) { setMsg('خطا در نویزگیری: ' + e.message); }
}
async function applyFilter(name) {
  if (!hasImage) { setMsg('اول یک عکس باز کنید'); return; }
  const flat = flattenToCanvas();
  const ctx = flat.getContext('2d', { willReadFrequently: true });
  if (name === 'original') { setMsg('فیلتر اصلی — بدون تغییر'); return; }
  if (name === 'warm' || name === 'cool' || name === 'vivid') {
    const v = { brightness: 0, contrast: name === 'vivid' ? 15 : 5, saturation: name === 'vivid' ? 40 : 10,
      warmth: name === 'warm' ? 30 : name === 'cool' ? -30 : 0, hue: 0, blur: 0, sharpen: 0 };
    let out;
    try { out = await tauriInvoke('adjust_image', { dataUrl: flat.toDataURL('image/png'), ...v }); }
    catch (e) { out = await jsAdjustPixels(flat.toDataURL('image/png'), v); }
    flattenIntoBase(); await loadFromDataURLKeepHistory(out);
  } else {
    const im = ctx.getImageData(0, 0, flat.width, flat.height);
    const d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (name === 'bw') {
        const v = 0.299 * r + 0.587 * g + 0.114 * b;
        d[i] = d[i + 1] = d[i + 2] = v;
      } else if (name === 'vintage') {
        d[i] = Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b);
        d[i + 1] = Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b);
        d[i + 2] = Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b);
      }
    }
    ctx.putImageData(im, 0, 0);
    flattenIntoBase();
    const img = await loadImage(flat.toDataURL('image/png'));
    work.width = img.width; work.height = img.height;
    wctx.drawImage(img, 0, 0);
    pushHistory(); render();
  }
  setMsg('فیلتر اعمال شد: ' + name);
}

/* ---------- چرخش / چرخاندن / اندازه ---------- */
function rotateSafe(dir) {
  if (!hasImage) return;
  const src = flattenToCanvas();
  const w = src.width, h = src.height;
  const nc = document.createElement('canvas'); nc.width = h; nc.height = w;
  const ctx = nc.getContext('2d');
  ctx.translate(dir === 'right' ? h : 0, dir === 'right' ? 0 : w);
  ctx.rotate(dir === 'right' ? Math.PI / 2 : -Math.PI / 2);
  ctx.drawImage(src, 0, 0);
  flattenIntoBase();
  work.width = h; work.height = w;
  wctx.clearRect(0, 0, h, w); wctx.drawImage(nc, 0, 0);
  pushHistory(); setZoom(0, true); render(); setMsg('چرخش انجام شد');
}
function flip(horizontal) {
  if (!hasImage) return;
  const src = flattenToCanvas();
  const nc = document.createElement('canvas'); nc.width = src.width; nc.height = src.height;
  const ctx = nc.getContext('2d');
  ctx.translate(horizontal ? src.width : 0, horizontal ? 0 : src.height);
  ctx.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
  ctx.drawImage(src, 0, 0);
  flattenIntoBase();
  wctx.clearRect(0, 0, src.width, src.height); wctx.drawImage(nc, 0, 0);
  pushHistory(); render(); setMsg(horizontal ? 'چرخاندن افقی انجام شد' : 'چرخاندن عمودی انجام شد');
}
async function resizeCurrent() {
  if (!hasImage) return;
  const w = parseInt($('resizeW').value, 10), h = parseInt($('resizeH').value, 10);
  if (!w || !h) { setMsg('عرض و ارتفاع را وارد کنید'); return; }
  setMsg('در حال تغییر اندازه با Rust…');
  try {
    const flat = flattenToCanvas().toDataURL('image/png');
    let out;
    try { out = await tauriInvoke('resize_image_data', { dataUrl: flat, width: w, height: h }); }
    catch (e) {
      const img = await loadImage(flat);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      out = c.toDataURL('image/png');
    }
    flattenIntoBase();
    await loadFromDataURLKeepHistory(out);
    setZoom(0, true);
    setMsg('اندازه تغییر کرد: ' + w + ' × ' + h);
  } catch (e) { setMsg('خطا در تغییر اندازه: ' + e.message); }
}
async function batchResize() {
  const w = parseInt($('batchW').value, 10) || 1024, h = parseInt($('batchH').value, 10) || 1024;
  $('batchInput').click();
  $('batchInput').onchange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    let folder = null;
    try { folder = await tauriInvoke('pick_folder_dialog', {}); } catch (err) { folder = null; }
    let done = 0;
    for (const f of files) {
      try {
        const dataUrl = await new Promise((res, rej) => {
          const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
        });
        let out;
        try { out = await tauriInvoke('resize_image_data', { dataUrl, width: w, height: h }); }
        catch (err) {
          const img = await loadImage(dataUrl);
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          out = c.toDataURL('image/png');
        }
        const name = 'resized-' + baseName(f.name) + '.png';
        if (folder) {
          await tauriInvoke('save_image_data_url', { path: folder + '/' + name, dataUrl: out });
        } else {
          downloadDataURL(out, name);
        }
        done++;
      } catch (err) { setMsg('خطا در ' + f.name + ': ' + err.message); }
    }
    setMsg('تغییر اندازه گروهی تمام شد: ' + done + ' عکس');
    e.target.value = '';
  };
}

/* ---------- رویدادهای ماوس روی بوم ---------- */
let pendingCloneSource = null;
function snapshotTarget() {
  const t = activeTarget();
  const c = document.createElement('canvas');
  c.width = t.canvas.width; c.height = t.canvas.height;
  c.getContext('2d').drawImage(t.canvas, 0, 0);
  return c;
}
const BRUSH_TOOLS = ['skin', 'heal', 'object', 'clone', 'smudge', 'dodge', 'burn', 'blurBrush', 'sharpenBrush', 'colorize', 'liquify'];
mainCanvas.addEventListener('pointerdown', (e) => {
  if (!hasImage) return;
  const pos = toImagePos(e);
  mainCanvas.setPointerCapture(e.pointerId);
  if (currentTool === 'crop') {
    cropStart = pos; cropRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
    drawOverlay(); return;
  }
  if (currentTool === 'text') { textPos = pos; drawOverlay(); setMsg('متن در اینجا قرار می‌گیرد — دکمه «افزودن متن» را بزنید'); return; }
  if (currentTool === 'redeye') { redeyeAt(pos); pushHistory(); render(); return; }
  if (currentTool === 'move') {
    const l = layers.find(x => x.id === activeLayerId);
    if (l) { dragLayer = { layer: l, start: pos, origX: l.x, origY: l.y }; }
    return;
  }
  if (BRUSH_TOOLS.includes(currentTool)) {
    if (currentTool === 'clone' && e.altKey) {
      pendingCloneSource = pos; cloneOffset = null;
      setMsg('منبع کلون انتخاب شد — حالا روی مقصد بکشید');
      return;
    }
    if (currentTool === 'clone' && pendingCloneSource) {
      cloneOffset = { dx: pendingCloneSource.x - pos.x, dy: pendingCloneSource.y - pos.y };
      pendingCloneSource = null;
    }
    isDrawing = true; lastPos = pos;
    strokeSnapshot = snapshotTarget();
    blurredCache = null; sharpenedCache = null; cacheFor = null;
    paintBrushStroke(pos, null);
    render();
  }
});
mainCanvas.addEventListener('pointermove', (e) => {
  if (!hasImage) return;
  const pos = toImagePos(e);
  if (currentTool === 'crop' && cropStart) {
    cropRect = { x: Math.min(cropStart.x, pos.x), y: Math.min(cropStart.y, pos.y),
      w: Math.abs(pos.x - cropStart.x), h: Math.abs(pos.y - cropStart.y) };
    drawOverlay(); return;
  }
  if (currentTool === 'move' && dragLayer) {
    dragLayer.layer.x = dragLayer.origX + (pos.x - dragLayer.start.x);
    dragLayer.layer.y = dragLayer.origY + (pos.y - dragLayer.start.y);
    render(); return;
  }
  if (isDrawing && BRUSH_TOOLS.includes(currentTool)) {
    if (currentTool === 'liquify') liquifyAt(pos, lastPos);
    else paintBrushStroke(pos, lastPos);
    lastPos = pos;
    render();
  }
});
function endStroke() {
  if (isDrawing) {
    isDrawing = false; strokeSnapshot = null;
    blurredCache = null; sharpenedCache = null; cacheFor = null;
    pushHistory();
  }
  if (dragLayer) { dragLayer = null; pushHistory(); }
  cropStart = null;
}
mainCanvas.addEventListener('pointerup', endStroke);
mainCanvas.addEventListener('pointercancel', endStroke);
mainCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

/* ---------- انتخاب ابزار ---------- */
const TOOL_NAMES = { move: 'جابه‌جا', skin: 'صاف پوست', heal: 'پاک لک', object: 'حذف شیء',
  clone: 'کلون', liquify: 'تغییر فرم', smudge: 'محو کردن', dodge: 'روشن کن', burn: 'تیره کن',
  blurBrush: 'تاری', sharpenBrush: 'وضوح', colorize: 'رنگی کن', redeye: 'چشم قرمز',
  crop: 'برش', text: 'متن' };
const TOOL_TIPS = {
  move: 'لایه فعال را بکشید تا جابه‌جا شود.',
  skin: 'روی پوست بکشید تا صاف و یکدست شود (Glamour Skin).',
  heal: 'روی لک یا جوش کلیک کنید تا پاک شود.',
  object: 'روی شیئی که می‌خواهید حذف شود بکشید.',
  clone: 'Alt + کلیک روی منبع، بعد روی مقصد بکشید.',
  liquify: 'بکشید تا فرم عکس جابه‌جا شود.',
  smudge: 'بکشید تا پیکسل‌ها محو و کشیده شوند.',
  dodge: 'روی ناحیه بکشید تا روشن‌تر شود.',
  burn: 'روی ناحیه بکشید تا تیره‌تر شود.',
  blurBrush: 'روی ناحیه بکشید تا تار شود.',
  sharpenBrush: 'روی ناحیه بکشید تا واضح‌تر شود.',
  colorize: 'با رنگ انتخاب‌شده روی ناحیه بکشید.',
  redeye: 'روی چشم قرمز کلیک کنید.',
  crop: 'مستطیل بکشید، بعد «اعمال برش» را بزنید.',
  text: 'روی عکس کلیک کنید، بعد «افزودن متن» را بزنید.',
};
function setTool(tool) {
  currentTool = tool;
  cropRect = null; textPos = null; drawOverlay();
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  setToolLabel(TOOL_NAMES[tool] || tool);
  $('toolTip').textContent = TOOL_TIPS[tool] || '';
  mainCanvas.style.cursor = tool === 'move' ? 'move' : tool === 'crop' || tool === 'text' ? 'crosshair' : 'none';
}
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

/* ---------- اتصال دکمه‌ها ---------- */
$('btnOpen').onclick = openImage;
$('btnSave').onclick = saveQuick;
$('btnSaveAs').onclick = saveAs;
$('btnUndo').onclick = undo;
$('btnRedo').onclick = redo;
$('btnReset').onclick = async () => {
  if (!history.length) return;
  hIndex = 0; await restoreSnapshot(history[0]); updateUndoButtons();
  resetAdjustSliders(); setMsg('به عکس اصلی برگشت');
};
$('zoomIn').onclick = () => setZoom(zoom * 1.25);
$('zoomOut').onclick = () => setZoom(zoom / 1.25);
$('zoomFit').onclick = () => setZoom(0, true);
$('brushSize').oninput = (e) => { brushSize = +e.target.value; $('brushSizeVal').textContent = brushSize; };
$('brushStrength').oninput = (e) => { brushStrength = +e.target.value; $('brushStrengthVal').textContent = brushStrength + '٪'; };
$('brushColor').oninput = (e) => { brushColor = e.target.value; };
['adjBright', 'adjContrast', 'adjSat', 'adjWarm', 'adjHue', 'adjBlur', 'adjSharp'].forEach(id => {
  const el = $(id); if (el) el.addEventListener('input', updateAdjustLabels);
});
$('btnApplyAdjust').onclick = applyAdjust;
$('btnResetAdjust').onclick = resetAdjustSliders;
$('btnApplyLevels').onclick = applyLevels;
$('btnApplyGlow').onclick = applyGlow;
$('glowAmt').oninput = (e) => { $('vGlow').textContent = e.target.value; };
$('btnDenoise').onclick = applyDenoise;
document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => applyFilter(b.dataset.filter));
$('btnRotL').onclick = () => rotateSafe('left');
$('btnRotR').onclick = () => rotateSafe('right');
$('btnFlipH').onclick = () => flip(true);
$('btnFlipV').onclick = () => flip(false);
$('btnResize').onclick = resizeCurrent;
$('resizeW').onchange = () => {
  if ($('keepAspect').checked && hasImage && $('resizeW').value) {
    $('resizeH').value = Math.round($('resizeW').value * work.height / work.width);
  }
};
$('resizeH').onchange = () => {
  if ($('keepAspect').checked && hasImage && $('resizeH').value) {
    $('resizeW').value = Math.round($('resizeH').value * work.width / work.height);
  }
};
$('btnCropApply').onclick = applyCrop;
$('btnCropCancel').onclick = () => { cropRect = null; drawOverlay(); setMsg('برش لغو شد'); };
$('btnTextApply').onclick = applyTextLayer;
$('btnAddLayerImg').onclick = () => $('layerInput').click();
$('btnFlatten').onclick = () => { if (!hasImage) return; flattenIntoBase(); pushHistory(); render(); setMsg('همه لایه‌ها ادغام شد'); };
$('layerOpacity').oninput = (e) => {
  $('layerOpacityVal').textContent = e.target.value + '٪';
  const l = layers.find(x => x.id === activeLayerId);
  if (l) { l.opacity = e.target.value / 100; render(); }
};
$('btnBatch').onclick = batchResize;
$('textInput').addEventListener('input', drawOverlay);
$('textSize').addEventListener('input', drawOverlay);
$('textColor').addEventListener('input', drawOverlay);

/* ---------- ورودی فایل و کشیدن و رها کردن ---------- */
$('fileInput').onchange = async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
  });
  await loadFromDataURL(dataUrl, f.name);
  e.target.value = '';
};
$('layerInput').onchange = async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f || !hasImage) return;
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
  });
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  c.width = work.width; c.height = work.height;
  const scale = Math.min(1, work.width / img.width, work.height / img.height);
  c.getContext('2d').drawImage(img, 0, 0, img.width * scale, img.height * scale);
  addLayer('عکس: ' + f.name.slice(0, 20), 'image', c, 0, 0);
  pushHistory();
  setMsg('لایه عکس اضافه شد');
  e.target.value = '';
};
['dragover', 'dragenter'].forEach(ev => canvasWrap.addEventListener(ev, (e) => { e.preventDefault(); }));
canvasWrap.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f || !f.type.startsWith('image/')) { setMsg('فایل عکس را رها کنید'); return; }
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
  });
  await loadFromDataURL(dataUrl, f.name);
});
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); redo(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); openImage(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveQuick(); }
  else if (e.key === '+' || e.key === '=') setZoom(zoom * 1.2);
  else if (e.key === '-') setZoom(zoom / 1.2);
  else if (e.key === 'Enter' && currentTool === 'text') applyTextLayer();
});

/* ---------- شروع ---------- */
(async () => {
  setTool('move');
  updateAdjustLabels();
  updateUndoButtons();
  renderLayersList();
  try {
    const info = await tauriInvoke('get_app_info', {});
    $('statusEngine').textContent = 'موتور: ' + info.engine + ' • نسخه ' + info.version;
  } catch (e) {
    $('statusEngine').textContent = 'موتور: مرورگر (پیش‌نمایش — در ویندوز با Rust اجرا می‌شود)';
  }
  render();
})();
