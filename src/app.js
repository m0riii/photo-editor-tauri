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
let savedHIndex = 0; // اندیس تاریخچه در آخرین ذخیره — برای پرسش ذخیره هنگام خروج
let originalDataUrl = null, originalImg = null, showingOriginal = false; // عکس اصلی برای دکمه Original
let isDrawing = false, lastPos = null, strokeSnapshot = null, cloneOffset = null;
let mousePos = null; // موقعیت نشانگر روی عکس (مختصات تصویر) برای پیش‌نمایش دایره قلم
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
function setToolLabel(name) { $('statusTool').textContent = t('toolPrefix') + name; }

/* ---------- زبان برنامه (فارسی / English) ---------- */
const I18N = {
  fa: {
    menuFile: 'فایل', menuEdit: 'ویرایش', menuView: 'نمایش', menuTools: 'ابزار', menuHelp: 'راهنما',
    open: 'باز کردن عکس', save: 'ذخیره', saveAs: 'ذخیره با نام…',
    original: 'بازگشت به اصلی', originalTitle: 'بازگرداندن عکس به حالت اول',
    compareOriginal: 'Original', compareOriginalTitle: 'نگه دارید تا عکس اصلی را ببینید',
    applyBtn: 'اعمال',
    saveAskTitle: 'تغییرات ذخیره نشده', saveAskText: 'عکس تغییر کرده است. قبل از خروج ذخیره شود؟',
    saveYes: 'ذخیره', saveNo: 'ذخیره نکن', saveCancel: 'لغو',
    msgShowingOriginal: 'در حال نمایش عکس اصلی — رها کنید تا به ویرایش برگردید',
    undo: 'واگرد', redo: 'از نو', fit: 'متناسب', zoomIn: 'بزرگ‌نمایی', zoomOut: 'کوچک‌نمایی',
    applyAdjust: 'اعمال تنظیمات', autoRetouch: 'روتوش خودکار', autoRetouchTitle: 'روتوش خودکار — مثل Facetune Enhance',
    aboutBtn: 'درباره', langBtn: 'زبان', toolsToggle: 'ابزارها',
    instruments: 'Instruments — ابزارها', mode: 'Mode — حالت ابزار',
    brushMode: 'Brush — قلم', eraserMode: 'Eraser — پاک‌کن',
    sizeLabel: 'Size — اندازه قلم', pixels: 'پیکسل', hardnessLabel: 'Hardness — سختی / قدرت', colorLabel: 'رنگ (برای رنگی کردن)',
    sumLight: '☀️ نور و رنگ — Brightness / Contrast', sumEffects: '🌟 افکت‌ها — Glow / Denoise',
    sumFilters: '🎞️ فیلترهای آماده', sumRotate: '🔄 چرخش، چرخاندن و اندازه — Scale / Rotate',
    sumCrop: '✂️ برش — Crop', sumText: '🔤 متن — Text', sumLayers: 'لایه‌ها — Layers', sumBatch: '📦 تغییر اندازه گروهی — Batch Resize',
    brightness: 'روشنایی', contrast: 'کنتراست', saturation: 'اشباع رنگ', warmth: 'گرما (Warmth)',
    hue: 'چرخش رنگ (Hue)', blur: 'تاری (Blur)', sharpen: 'وضوح (Sharpen)',
    reset: 'بازنشانی', levelsLabel: 'سطوح رنگ (Levels) — سایه / میانه / نور', applyLevels: '✓ اعمال سطوح رنگ',
    glow: 'درخشش (Glow)', applyGlow: '✓ اعمال درخشش', denoise: '🧹 نویزگیری (Denoise — Rust)',
    filterOriginal: 'اصلی', filterWarm: 'گرم', filterCool: 'سرد', filterBw: 'سیاه‌سفید', filterVintage: 'قدیمی', filterVivid: 'زنده',
    rotL: '⟲ ۹۰° چپ', rotR: '⟳ ۹۰° راست', flipH: '⇔ افقی', flipV: '⇕ عمودی',
    newWidth: 'عرض جدید', newHeight: 'ارتفاع جدید', widthPh: 'عرض', heightPh: 'ارتفاع',
    keepAspect: 'حفظ نسبت ابعاد', resizeBtn: '✓ تغییر اندازه (Rust)',
    cropTip: 'با ابزار برش روی عکس مستطیل بکشید، بعد:', cropApply: '✓ اعمال برش', cancel: 'لغو',
    textLabel: 'متن', textPh: 'متن را اینجا بنویسید', textSize: 'اندازه', textColor: 'رنگ', textFont: 'فونت',
    addText: '✓ افزودن متن به‌عنوان لایه', textTip: 'بعد از افزودن، متن را با ابزار «جابه‌جا» می‌توانید بکشید.',
    noLayers: 'هنوز لایه‌ای نیست — متن یا عکس روی هم اضافه کنید.', addLayerImg: '➕ لایه از عکس…',
    flatten: '⤵ ادغام همه لایه‌ها', layerOpacity: 'شفافیت لایه فعال',
    width: 'عرض', height: 'ارتفاع',
    batchTip: 'چند عکس انتخاب کنید؛ همه به یک اندازه تبدیل و دانلود می‌شوند.', batchBtn: '📦 انتخاب چند عکس و تبدیل',
    dropTitle: 'عکس را اینجا رها کنید', dropText: 'یا از منوی «فایل»، «باز کردن عکس» را بزنید — JPG ،PNG ،BMP ،GIF',
    dropNote: 'عکس شما از دستگاهتان بیرون نمی‌رود؛ همه‌چیز روی همین کامپیوتر پردازش می‌شود.',
    engine: 'موتور: Rust + Tauri',
    aboutBy: 'ساخته شده توسط Mori J', aboutIdea: 'ایده از برنامه PhotoInstrument', close: 'بستن',
    langTitle: 'زبان برنامه را انتخاب کنید', langSub: 'Choose the app language',
    aboutVer: 'نسخه ۱٫۰٫۶ • Rust + Tauri',
    toolPrefix: 'ابزار: ',
    msgOpenFirst: 'اول یک عکس باز کنید', msgUndo: 'واگرد انجام شد', msgRedo: 'از نو انجام شد',
    msgOpened: 'عکس باز شد: ', msgSaved: 'ذخیره شد: ',
    msgBmpGif: 'در مرورگر BMP/GIF پشتیبانی نمی‌شود؛ نسخه PNG دانلود شد', msgDownloaded: 'دانلود شد: ',
    msgCloneSrc: 'برای کلون اول Alt + کلیک کنید تا منبع انتخاب شود',
    msgCropFirst: 'اول با ابزار برش یک مستطیل بکشید', msgCropDone: 'برش اعمال شد',
    msgWriteText: 'متن را بنویسید', msgTextAdded: 'متن به‌عنوان لایه اضافه شد — با ابزار جابه‌جا می‌توانید آن را بکشید',
    msgLevelsErr: 'نقطه سفید باید بزرگ‌تر از نقطه سیاه باشد', msgLevelsDone: 'سطوح رنگ اعمال شد',
    msgGlowMore: 'مقدار درخشش را بیشتر کنید', msgGlowDone: 'درخشش اعمال شد',
    msgApplying: 'در حال اعمال با Rust…', msgAdjustDone: 'تنظیم نور و رنگ اعمال شد', msgAdjustErr: 'خطا در اعمال تنظیمات: ',
    msgDenoising: 'در حال نویزگیری با Rust…', msgDenoiseDone: 'نویزگیری انجام شد', msgDenoiseErr: 'خطا در نویزگیری: ',
    msgRetouching: 'در حال روتوش خودکار با Rust…', msgRetouchDone: 'روتوش خودکار انجام شد ✨', msgRetouchErr: 'خطا در روتوش خودکار: ',
    msgFilterOrig: 'فیلتر اصلی — بدون تغییر', msgFilterDone: 'فیلتر اعمال شد: ',
    msgRotated: 'چرخش انجام شد', msgEnterWH: 'عرض و ارتفاع را وارد کنید',
    msgResizing: 'در حال تغییر اندازه با Rust…', msgResized: 'اندازه تغییر کرد: ', msgResizeErr: 'خطا در تغییر اندازه: ',
    msgBatchErr: 'خطا در ', msgBatchDone: 'تغییر اندازه گروهی تمام شد: ', msgPhotos: ' عکس',
    msgTextHere: 'متن در اینجا قرار می‌گیرد — دکمه «افزودن متن» را بزنید',
    msgClonePicked: 'منبع کلون انتخاب شد — حالا روی مقصد بکشید',
    msgBackOriginal: 'به عکس اصلی برگشت', msgCropCancel: 'برش لغو شد', msgFlatten: 'همه لایه‌ها ادغام شد',
    msgLayerAdded: 'لایه عکس اضافه شد', msgDropImage: 'فایل عکس را رها کنید',
  },
  en: {
    menuFile: 'File', menuEdit: 'Edit', menuView: 'View', menuTools: 'Tools', menuHelp: 'Help',
    open: 'Open Image', save: 'Save', saveAs: 'Save As…',
    original: 'Reset to Original', originalTitle: 'Restore the original image',
    compareOriginal: 'Original', compareOriginalTitle: 'Hold to see the original photo',
    applyBtn: 'Apply',
    saveAskTitle: 'Unsaved changes', saveAskText: 'The photo has unsaved changes. Save before closing?',
    saveYes: 'Save', saveNo: "Don't Save", saveCancel: 'Cancel',
    msgShowingOriginal: 'Showing the original photo — release to go back to your edit',
    undo: 'Undo', redo: 'Redo', fit: 'Fit', zoomIn: 'Zoom In', zoomOut: 'Zoom Out',
    applyAdjust: 'Apply Adjustments', autoRetouch: 'Auto Retouch', autoRetouchTitle: 'Auto Retouch — like Facetune Enhance',
    aboutBtn: 'About', langBtn: 'Language', toolsToggle: 'Tools',
    instruments: 'Instruments', mode: 'Mode',
    brushMode: 'Brush', eraserMode: 'Eraser',
    sizeLabel: 'Size — Brush size', pixels: 'px', hardnessLabel: 'Hardness — Strength', colorLabel: 'Color (for Colorize)',
    sumLight: '☀️ Brightness / Contrast', sumEffects: '🌟 Effects — Glow / Denoise',
    sumFilters: '🎞️ Preset Filters', sumRotate: '🔄 Rotate, Flip & Scale',
    sumCrop: '✂️ Crop', sumText: '🔤 Text', sumLayers: 'Layers', sumBatch: '📦 Batch Resize',
    brightness: 'Brightness', contrast: 'Contrast', saturation: 'Saturation', warmth: 'Warmth',
    hue: 'Hue', blur: 'Blur', sharpen: 'Sharpen',
    reset: 'Reset', levelsLabel: 'Color Levels — Shadows / Midtones / Highlights', applyLevels: '✓ Apply Levels',
    glow: 'Glow', applyGlow: '✓ Apply Glow', denoise: '🧹 Denoise (Rust)',
    filterOriginal: 'Original', filterWarm: 'Warm', filterCool: 'Cool', filterBw: 'Black & White', filterVintage: 'Vintage', filterVivid: 'Vivid',
    rotL: '⟲ 90° Left', rotR: '⟳ 90° Right', flipH: '⇔ Horizontal', flipV: '⇕ Vertical',
    newWidth: 'New width', newHeight: 'New height', widthPh: 'Width', heightPh: 'Height',
    keepAspect: 'Keep aspect ratio', resizeBtn: '✓ Resize (Rust)',
    cropTip: 'Draw a rectangle on the photo with the Crop tool, then:', cropApply: '✓ Apply Crop', cancel: 'Cancel',
    textLabel: 'Text', textPh: 'Type your text here', textSize: 'Size', textColor: 'Color', textFont: 'Font',
    addText: '✓ Add Text as Layer', textTip: 'After adding, drag the text with the Move tool.',
    noLayers: 'No layers yet — add text or an image on top.', addLayerImg: '➕ Layer from Image…',
    flatten: '⤵ Flatten All Layers', layerOpacity: 'Active layer opacity',
    width: 'Width', height: 'Height',
    batchTip: 'Pick several photos; all will be resized to one size and downloaded.', batchBtn: '📦 Pick Photos & Convert',
    dropTitle: 'Drop your photo here', dropText: 'Or use File → Open Image — JPG, PNG, BMP, GIF',
    dropNote: 'Your photo never leaves your device; everything is processed on this computer.',
    engine: 'Engine: Rust + Tauri',
    aboutBy: 'Made by Mori J', aboutIdea: 'Idea from PhotoInstrument', close: 'Close',
    langTitle: 'Choose the app language', langSub: 'زبان برنامه را انتخاب کنید',
    aboutVer: 'Version 1.0.6 • Rust + Tauri',
    toolPrefix: 'Tool: ',
    msgOpenFirst: 'Open a photo first', msgUndo: 'Undone', msgRedo: 'Redone',
    msgOpened: 'Photo opened: ', msgSaved: 'Saved: ',
    msgBmpGif: 'BMP/GIF is not supported in the browser; PNG version downloaded', msgDownloaded: 'Downloaded: ',
    msgCloneSrc: 'For Clone, Alt + Click to pick the source first',
    msgCropFirst: 'Draw a rectangle with the Crop tool first', msgCropDone: 'Crop applied',
    msgWriteText: 'Write the text first', msgTextAdded: 'Text added as a layer — drag it with the Move tool',
    msgLevelsErr: 'White point must be greater than black point', msgLevelsDone: 'Levels applied',
    msgGlowMore: 'Increase the glow amount first', msgGlowDone: 'Glow applied',
    msgApplying: 'Applying with Rust…', msgAdjustDone: 'Brightness & color applied', msgAdjustErr: 'Error applying adjustments: ',
    msgDenoising: 'Denoising with Rust…', msgDenoiseDone: 'Denoise done', msgDenoiseErr: 'Denoise error: ',
    msgRetouching: 'Auto-retouching with Rust…', msgRetouchDone: 'Auto retouch done ✨', msgRetouchErr: 'Auto retouch error: ',
    msgFilterOrig: 'Original filter — no change', msgFilterDone: 'Filter applied: ',
    msgRotated: 'Rotated', msgEnterWH: 'Enter width and height',
    msgResizing: 'Resizing with Rust…', msgResized: 'Resized to: ', msgResizeErr: 'Resize error: ',
    msgBatchErr: 'Error in ', msgBatchDone: 'Batch resize finished: ', msgPhotos: ' photos',
    msgTextHere: 'Text will go here — click “Add Text”',
    msgClonePicked: 'Clone source picked — now paint on the target',
    msgBackOriginal: 'Back to the original photo', msgCropCancel: 'Crop cancelled', msgFlatten: 'All layers flattened',
    msgLayerAdded: 'Image layer added', msgDropImage: 'Drop an image file',
  },
};
let currentLang = 'fa';
function t(key) { return (I18N[currentLang] && I18N[currentLang][key]) || I18N.fa[key] || key; }
function pct(n) { return n + (currentLang === 'fa' ? '٪' : '%'); }
function applyLanguage(lang, save) {
  if (!I18N[lang]) lang = 'fa';
  currentLang = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  if (save !== false) { try { localStorage.setItem('mori-lang', lang); } catch (e) {} }
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (key.startsWith('menu')) {
      if (el.dataset.fa === undefined) el.dataset.fa = el.childNodes[0].textContent.trim();
      const span = el.querySelector('.menu-en');
      if (lang === 'en') { el.childNodes[0].textContent = t(key) + ' '; if (span) span.style.display = 'none'; }
      else { el.childNodes[0].textContent = el.dataset.fa + ' '; if (span) span.style.display = ''; }
      return;
    }
    const v = t(key);
    if (v !== undefined) el.textContent = v;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('.tool').forEach(b => {
    const tool = b.dataset.tool;
    const span = b.querySelector('span');
    if (span && TOOL_NAMES[lang] && TOOL_NAMES[lang][tool]) span.textContent = TOOL_NAMES[lang][tool];
    const en = b.querySelector('.en');
    if (en) en.style.display = lang === 'en' ? 'none' : '';
  });
  $('langModal').hidden = true;
  updateToolStatus();
  $('toolTip').textContent = (TOOL_TIPS[lang] && TOOL_TIPS[lang][currentTool]) || '';
  $('zoomLabel').textContent = Math.round(zoom * 100) + (lang === 'fa' ? '٪' : '%');
  $('brushStrengthVal').textContent = pct(brushStrength);
  const op = $('layerOpacity'); if (op) $('layerOpacityVal').textContent = pct(+op.value);
}
function showLangPicker() { $('langModal').hidden = false; }


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
  updateThumbs();
}
function updateUndoButtons() {
  $('btnUndo').disabled = hIndex <= 0;
  $('btnRedo').disabled = hIndex >= history.length - 1;
  const tu = $('tbUndo'), tr = $('tbRedo');
  if (tu) tu.disabled = hIndex <= 0;
  if (tr) tr.disabled = hIndex >= history.length - 1;
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
  hIndex--; await restoreSnapshot(history[hIndex]); updateUndoButtons(); setMsg(t('msgUndo'));
}
async function redo() {
  if (hIndex >= history.length - 1) return;
  hIndex++; await restoreSnapshot(history[hIndex]); updateUndoButtons(); setMsg(t('msgRedo'));
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
  $('zoomLabel').textContent = pct(Math.round(zoom * 100));
  const tbz = $('tbZoom'); if (tbz) tbz.textContent = Math.round(zoom * 100) + '%';
  $('statusSize').textContent = work.width + ' × ' + work.height + ' ' + (currentLang === 'fa' ? 'پیکسل' : 'px') +
    (layers.length ? ' • ' + layers.length + ' ' + (currentLang === 'fa' ? 'لایه' : 'layers') : '');
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
  savedHIndex = hIndex;
  originalDataUrl = dataUrl; originalImg = img;
  setZoom(0, true);
  renderLayersList();
  setMsg(t('msgOpened') + currentFileName);
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
  if (!hasImage) { setMsg(t('msgOpenFirst')); return false; }
  const format = (currentFileName.split('.').pop() || 'png').toLowerCase();
  let dataUrl = compositeDataURL(format);
  const outName = baseName(currentFileName) + '.' + (format === 'jpeg' ? 'jpg' : format);
  try {
    if (format === 'gif' || format === 'bmp') {
      // تبدیل واقعی فرمت با Rust (image crate) — قبلاً PNG با پسوند bmp ذخیره می‌شد
      dataUrl = await tauriInvoke('convert_image_format', { dataUrl, format });
    }
    const path = await tauriInvoke('save_image_dialog', { defaultName: outName });
    if (!path) return false;
    await tauriInvoke('save_image_data_url', { path, dataUrl });
    setMsg(t('msgSaved') + path);
    savedHIndex = hIndex;
    return true;
  } catch (e) {
    if (format === 'bmp' || format === 'gif') {
      // در پیش‌نمایش مرورگر encoder برای BMP/GIF نیست؛ PNG ذخیره می‌شود
      downloadDataURL(dataUrl, baseName(currentFileName) + '.png');
      setMsg(t('msgBmpGif'));
    } else {
      downloadDataURL(dataUrl, outName);
      setMsg(t('msgDownloaded') + outName);
    }
    savedHIndex = hIndex;
    return true;
  }
}
async function saveQuick() {
  if (!hasImage) { setMsg(t('msgOpenFirst')); return false; }
  return await saveAs();
}

/* ---------- تصویر کوچک پیش‌نمایش + دکمه Original ---------- */
function updateThumbs() {
  if (!hasImage) return;
  try {
    const url = flattenToCanvas().toDataURL('image/jpeg', 0.55);
    const top = $('topThumb'), left = $('leftThumb');
    if (top) { top.src = url; $('topPreview').hidden = false; }
    if (left) { left.src = url; $('leftThumbBox').hidden = false; }
  } catch (e) { /* پیش‌نمایش کوچک اختیاری است */ }
}
// دکمه Original در نوار بالا: تا وقتی نگه داشته می‌شود عکس اصلی را نشان می‌دهد،
 // مثل PhotoInstrument — با رها کردن، ویرایش برمی‌گردد
function showOriginal() {
  if (!hasImage || !originalImg || showingOriginal) return;
  showingOriginal = true;
  const dw = mainCanvas.width, dh = mainCanvas.height;
  mctx.clearRect(0, 0, dw, dh);
  mctx.imageSmoothingQuality = 'high';
  mctx.drawImage(originalImg, 0, 0, dw, dh);
  $('btnOriginal').classList.add('active');
  setMsg(t('msgShowingOriginal'));
}
function hideOriginal() {
  if (!showingOriginal) return;
  showingOriginal = false;
  $('btnOriginal').classList.remove('active');
  setMsg('');
  render();
}

/* ---------- پرسش ذخیره هنگام خروج ---------- */
function isDirty() { return hasImage && hIndex !== savedHIndex; }
function closeAppWindow() {
  tauriInvoke('close_window', {}).catch(() => { /* در مرورگر پنجره‌ای برای بستن نیست */ });
}
function requestClose() {
  if (!isDirty()) { closeAppWindow(); return; }
  $('saveModal').hidden = false;
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
      paintFrom(blurredCache, p, p, currentTool === 'skin' ? a * 0.85 : a);
    } else if (currentTool === 'sharpenBrush') {
      ensureDerived();
      paintFrom(sharpenedCache, p, p, a);
    } else if (currentTool === 'heal' || currentTool === 'object') {
      healAt(p, currentTool === 'object' ? 1.6 : 1);
    } else if (currentTool === 'clone') {
      if (!cloneOffset) { setMsg(t('msgCloneSrc')); return; }
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
    } else if (currentTool === 'whiten') {
      whitenAt(p);
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
function whitenAt(pos) {
  // سفید کردن دندان / روشن کردن چشم (Whiten — مثل Facetune): کم‌رنگ + روشن به سمت سفید
  const t = activeTarget();
  const r = brushSize / 2;
  const x0 = Math.max(0, Math.floor(pos.x - r)), y0 = Math.max(0, Math.floor(pos.y - r));
  const x1 = Math.min(t.canvas.width, Math.ceil(pos.x + r)), y1 = Math.min(t.canvas.height, Math.ceil(pos.y + r));
  if (x1 <= x0 || y1 <= y0) return;
  const im = t.ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  const d = im.data, a = brushStrength / 100;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dist = Math.hypot(x - pos.x, y - pos.y) / r;
      if (dist > 1) continue;
      const wgt = (1 - dist * dist) * a * 0.5;
      const i = ((y - y0) * (x1 - x0) + (x - x0)) * 4;
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      for (let c = 0; c < 3; c++) {
        let v = gray + (d[i + c] - gray) * 0.7;
        v = v + (255 - v) * wgt;
        d[i + c] = v;
      }
    }
  }
  t.ctx.putImageData(im, x0, y0);
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
  // پیش‌نمایش زنده قلم: دایره‌ای به اندازه قلم روی بوم overlay (نه روی عکس)
  // تا نشانگر هیچ‌وقت نامرئی نماند و محل اثر قلم دیده شود.
  if (mousePos && hasImage && (BRUSH_TOOLS.includes(currentTool) || currentTool === 'redeye')) {
    const r = (currentTool === 'redeye' ? Math.max(10, brushSize / 4) : brushSize / 2) * zoom;
    const cx = mousePos.x * zoom, cy = mousePos.y * zoom;
    octx.save();
    octx.beginPath(); octx.arc(cx, cy, Math.max(2, r), 0, Math.PI * 2);
    octx.strokeStyle = 'rgba(0,0,0,0.85)'; octx.lineWidth = 3.5; octx.stroke();
    octx.beginPath(); octx.arc(cx, cy, Math.max(2, r), 0, Math.PI * 2);
    octx.strokeStyle = 'rgba(255,255,255,0.95)'; octx.lineWidth = 1.5; octx.stroke();
    octx.beginPath(); octx.arc(cx, cy, 1.8, 0, Math.PI * 2);
    octx.fillStyle = '#fff'; octx.fill();
    octx.strokeStyle = 'rgba(0,0,0,0.85)'; octx.lineWidth = 1; octx.stroke();
    octx.restore();
  }
}
function applyCrop() {
  if (!cropRect || cropRect.w < 4 || cropRect.h < 4) { setMsg(t('msgCropFirst')); return; }
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
  setMsg(t('msgCropDone'));
}
function applyTextLayer() {
  if (!hasImage) { setMsg(t('msgOpenFirst')); return; }
  const text = $('textInput').value.trim();
  if (!text) { setMsg(t('msgWriteText')); return; }
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
  setMsg(t('msgTextAdded'));
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
  if (!hasImage) { setMsg(t('msgOpenFirst')); return; }
  const v = adjValues();
  setMsg(t('msgApplying'));
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
    setMsg(t('msgAdjustDone'));
  } catch (e) { setMsg(t('msgAdjustErr') + e.message); }
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
  if (white <= black) { setMsg(t('msgLevelsErr')); return; }
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
  pushHistory(); render(); setMsg(t('msgLevelsDone'));
}
async function applyGlow() {
  if (!hasImage) return;
  const amt = +$('glowAmt').value;
  if (amt <= 0) { setMsg(t('msgGlowMore')); return; }
  flattenIntoBase();
  const glow = blurredCopyOf(work, 12);
  wctx.save(); wctx.globalCompositeOperation = 'screen';
  wctx.globalAlpha = amt / 100 * 0.7; wctx.drawImage(glow, 0, 0); wctx.restore();
  pushHistory(); render(); setMsg(t('msgGlowDone'));
}
async function applyDenoise() {
  if (!hasImage) return;
  setMsg(t('msgDenoising'));
  try {
    const flat = flattenToCanvas().toDataURL('image/png');
    let out;
    try { out = await tauriInvoke('denoise_image', { dataUrl: flat, strength: 60 }); }
    catch (e) { out = await jsAdjustPixels(flat, { brightness: 0, contrast: 0, saturation: 0, warmth: 0, hue: 0, blur: 1.5, sharpen: 0 }); }
    flattenIntoBase();
    await loadFromDataURLKeepHistory(out);
    setMsg(t('msgDenoiseDone'));
  } catch (e) { setMsg(t('msgDenoiseErr') + e.message); }
}
async function applyAutoRetouch() {
  // روتوش خودکار با یک کلیک (مثل Facetune Enhance) — با Rust
  if (!hasImage) { setMsg(t('msgOpenFirst')); return; }
  setMsg(t('msgRetouching'));
  try {
    const flat = flattenToCanvas().toDataURL('image/png');
    let out;
    try { out = await tauriInvoke('auto_retouch_image', { dataUrl: flat }); }
    catch (e) {
      out = await tauriInvoke('adjust_image', { dataUrl: flat, brightness: 5, contrast: 8, saturation: 12, warmth: 2, hue: 0, blur: 0, sharpen: 0 });
    }
    flattenIntoBase();
    await loadFromDataURLKeepHistory(out);
    setMsg(t('msgRetouchDone'));
  } catch (e) { setMsg(t('msgRetouchErr') + e.message); }
}
async function applyFilter(name) {
  if (!hasImage) { setMsg(t('msgOpenFirst')); return; }
  const flat = flattenToCanvas();
  const ctx = flat.getContext('2d', { willReadFrequently: true });
  if (name === 'original') { setMsg(t('msgFilterOrig')); return; }
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
  setMsg(t('msgFilterDone') + name);
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
  pushHistory(); setZoom(0, true); render(); setMsg(t('msgRotated'));
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
  if (!w || !h) { setMsg(t('msgEnterWH')); return; }
  setMsg(t('msgResizing'));
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
    setMsg(t('msgResized') + w + ' × ' + h);
  } catch (e) { setMsg(t('msgResizeErr') + e.message); }
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
      } catch (err) { setMsg(t('msgBatchErr') + f.name + ': ' + err.message); }
    }
    setMsg(t('msgBatchDone') + done + t('msgPhotos'));
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
const BRUSH_TOOLS = ['skin', 'heal', 'object', 'clone', 'smudge', 'dodge', 'burn', 'blurBrush', 'sharpenBrush', 'colorize', 'liquify', 'whiten'];
mainCanvas.addEventListener('pointerdown', (e) => {
  if (!hasImage) return;
  const pos = toImagePos(e);
  mainCanvas.setPointerCapture(e.pointerId);
  if (currentTool === 'crop') {
    cropStart = pos; cropRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
    drawOverlay(); return;
  }
  if (currentTool === 'text') { textPos = pos; drawOverlay(); setMsg(t('msgTextHere')); return; }
  if (currentTool === 'redeye') { redeyeAt(pos); pushHistory(); render(); return; }
  if (currentTool === 'move') {
    const l = layers.find(x => x.id === activeLayerId);
    if (l) { dragLayer = { layer: l, start: pos, origX: l.x, origY: l.y }; }
    return;
  }
  if (BRUSH_TOOLS.includes(currentTool)) {
    if (currentTool === 'clone' && e.altKey) {
      pendingCloneSource = pos; cloneOffset = null;
      setMsg(t('msgClonePicked'));
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
    drawOverlay();
  }
});
mainCanvas.addEventListener('pointermove', (e) => {
  if (!hasImage) return;
  const pos = toImagePos(e);
  mousePos = pos; // موقعیت نشانگر را همیشه دنبال کن، حتی وقتی نقاشی نمی‌کنیم
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
    drawOverlay(); // دایره پیش‌نمایش قلم را همراه نشانگر حرکت بده
  } else if (BRUSH_TOOLS.includes(currentTool) || currentTool === 'redeye') {
    drawOverlay(); // شناور بودن روی عکس: فقط پیش‌نمایش را تازه کن، بدون نقاشی
  }
});
mainCanvas.addEventListener('pointerleave', () => { mousePos = null; drawOverlay(); });
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
const TOOL_NAMES = {
  fa: { move: 'جابه‌جا', skin: 'صاف پوست', heal: 'پاک لک', object: 'حذف شیء',
    clone: 'کلون', liquify: 'تغییر فرم', smudge: 'محو کردن', dodge: 'روشن کن', burn: 'تیره کن',
    blurBrush: 'تاری', sharpenBrush: 'وضوح', colorize: 'رنگی کن', redeye: 'چشم قرمز',
    crop: 'برش', text: 'متن', whiten: 'سفید کن' },
  en: { move: 'Move', skin: 'Glamour Skin', heal: 'Skin Cleaner', object: 'Healing Brush',
    clone: 'Clone', liquify: 'Liquify', smudge: 'Smudge', dodge: 'Dodge', burn: 'Burn',
    blurBrush: 'Blur', sharpenBrush: 'Sharpen', colorize: 'Colorize', redeye: 'Red Eye Removal',
    crop: 'Crop', text: 'Text', whiten: 'Whiten' },
};
const TOOL_TIPS = {
  fa: {
    move: 'لایه فعال را بکشید تا جابه‌جا شود.',
    skin: 'روی پوست بکشید تا صاف و یکدست شود (Glamour Skin).',
    heal: 'روی لک یا جوش کلیک کنید تا پاک شود.',
    whiten: 'روی دندان یا چشم بکشید تا سفیدتر و روشن‌تر شود (Whiten).',
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
  },
  en: {
    move: 'Drag the active layer to move it.',
    skin: 'Paint over skin to smooth it (Glamour Skin).',
    heal: 'Click a blemish or pimple to remove it.',
    whiten: 'Paint over teeth or eyes to whiten and brighten them (Whiten).',
    object: 'Paint over the object you want to remove.',
    clone: 'Alt + Click the source, then paint.',
    liquify: 'Drag to push the photo shape.',
    smudge: 'Drag to smear the pixels.',
    dodge: 'Paint to brighten the area.',
    burn: 'Paint to darken the area.',
    blurBrush: 'Paint to blur the area.',
    sharpenBrush: 'Paint to sharpen the area.',
    colorize: 'Paint with the chosen color.',
    redeye: 'Click a red eye.',
    crop: 'Draw a rectangle, then click “Apply Crop”.',
    text: 'Click the photo, then click “Add Text”.',
  },
};
function updateToolStatus() {
  const name = (TOOL_NAMES[currentLang] && TOOL_NAMES[currentLang][currentTool]) || currentTool;
  const isBrush = BRUSH_TOOLS.includes(currentTool) || currentTool === 'redeye';
  setToolLabel(isBrush ? (currentLang === 'fa' ? name + ' • قلم ' + brushSize + ' پیکسل' : name + ' • Brush ' + brushSize + 'px') : name);
}
function setTool(tool) {
  currentTool = tool;
  cropRect = null; textPos = null; drawOverlay();
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  updateToolStatus();
  $('toolTip').textContent = (TOOL_TIPS[currentLang] && TOOL_TIPS[currentLang][tool]) || '';
  // نشانگر هیچ‌وقت نامرئی نمی‌شود: برای ابزارهای قلمی crosshair + دایره پیش‌نمایش
  mainCanvas.style.cursor = tool === 'move' ? 'move' : 'crosshair';
}
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

/* ---------- منوهای کشویی ---------- */
document.querySelectorAll('.menu > .menu-item').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const drop = btn.parentElement.querySelector('.menu-drop');
    const wasOpen = drop.classList.contains('open');
    document.querySelectorAll('.menu-drop.open').forEach(d => d.classList.remove('open'));
    if (!wasOpen) drop.classList.add('open');
  });
});
document.addEventListener('click', () => document.querySelectorAll('.menu-drop.open').forEach(d => d.classList.remove('open')));

/* ---------- نوار ابزار بالایی + دکمه Original ---------- */
$('tbUndo').onclick = undo;
$('tbRedo').onclick = redo;
$('tbZoomIn').onclick = () => setZoom(zoom * 1.25);
$('tbZoomOut').onclick = () => setZoom(zoom / 1.25);
$('tbApply').onclick = applyAdjust;
const btnOriginal = $('btnOriginal');
btnOriginal.addEventListener('pointerdown', (e) => { e.preventDefault(); showOriginal(); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btnOriginal.addEventListener(ev, hideOriginal));
btnOriginal.addEventListener('contextmenu', (e) => e.preventDefault());

/* ---------- بستن برنامه: اگر تغییر ذخیره‌نشده هست، اول بپرس ---------- */
$('btnSaveYes').onclick = async () => { $('saveModal').hidden = true; const ok = await saveQuick(); if (ok) closeAppWindow(); };
$('btnSaveNo').onclick = () => { $('saveModal').hidden = true; closeAppWindow(); };
$('btnSaveCancel').onclick = () => { $('saveModal').hidden = true; };
try {
  const tev = window.__TAURI__ && window.__TAURI__.event;
  if (tev && typeof tev.listen === 'function') tev.listen('close-requested', requestClose);
} catch (e) { /* در مرورگر معمولی رویداد بستن وجود ندارد */ }

/* ---------- پنجره درباره برنامه ---------- */
function openAbout() { $('aboutModal').hidden = false; }
function closeAbout() { $('aboutModal').hidden = true; }
$('btnAbout').onclick = openAbout;
$('aboutClose').onclick = closeAbout;
$('btnLang').onclick = showLangPicker;
$('langFa').onclick = () => applyLanguage('fa');
$('langEn').onclick = () => applyLanguage('en');
$('aboutModal').addEventListener('click', (e) => { if (e.target === $('aboutModal')) closeAbout(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeAbout(); $('saveModal').hidden = true; } });

/* ---------- اتصال دکمه‌ها ---------- */
$('btnOpen').onclick = openImage;
$('btnSave').onclick = saveQuick;
$('btnSaveAs').onclick = saveAs;
$('btnUndo').onclick = undo;
$('btnRedo').onclick = redo;
$('btnReset').onclick = async () => {
  if (!history.length) return;
  hIndex = 0; await restoreSnapshot(history[0]); updateUndoButtons();
  resetAdjustSliders(); setMsg(t('msgBackOriginal'));
};
$('zoomIn').onclick = () => setZoom(zoom * 1.25);
$('zoomOut').onclick = () => setZoom(zoom / 1.25);
$('zoomFit').onclick = () => setZoom(0, true);
$('brushSize').oninput = (e) => { brushSize = +e.target.value; $('brushSizeVal').textContent = brushSize; updateToolStatus(); drawOverlay(); };
$('brushStrength').oninput = (e) => { brushStrength = +e.target.value; $('brushStrengthVal').textContent = pct(brushStrength); };
$('brushColor').oninput = (e) => { brushColor = e.target.value; };
['adjBright', 'adjContrast', 'adjSat', 'adjWarm', 'adjHue', 'adjBlur', 'adjSharp'].forEach(id => {
  const el = $(id); if (el) el.addEventListener('input', updateAdjustLabels);
});
$('btnApplyAdjust').onclick = applyAdjust;
$('btnAutoRetouch').onclick = applyAutoRetouch;
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
$('btnCropCancel').onclick = () => { cropRect = null; drawOverlay(); setMsg(t('msgCropCancel')); };
$('btnTextApply').onclick = applyTextLayer;
$('btnAddLayerImg').onclick = () => $('layerInput').click();
$('btnFlatten').onclick = () => { if (!hasImage) return; flattenIntoBase(); pushHistory(); render(); setMsg(t('msgFlatten')); };
$('layerOpacity').oninput = (e) => {
  $('layerOpacityVal').textContent = pct(+e.target.value);
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
  setMsg(t('msgLayerAdded'));
  e.target.value = '';
};
['dragover', 'dragenter'].forEach(ev => canvasWrap.addEventListener(ev, (e) => { e.preventDefault(); }));
canvasWrap.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f || !f.type.startsWith('image/')) { setMsg(t('msgDropImage')); return; }
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

/* ---------- زبان: اول برنامه بپرس، بعد یادت باشد ---------- */
try {
  const savedLang = localStorage.getItem('mori-lang');
  if (savedLang === 'en' || savedLang === 'fa') applyLanguage(savedLang, false);
  else { applyLanguage('fa', false); showLangPicker(); }
} catch (e) { applyLanguage('fa', false); showLangPicker(); }
