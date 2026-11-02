// WPaint
//
// Shows a template image over the map. While Auto Place is on and the site's
// paint palette is open, each template pixel the mouse passes over gets its color
// picked and is clicked for you. Auto-Paint does the same for the pixels on screen,
// up to your available charges. Nothing is sent to the server until you press the
// site's own Paint button, so the normal paint flow and its checks stay as they are.
(() => {
  'use strict';
  if (window.__wplaceHoverPaint) return;
  window.__wplaceHoverPaint = true;

  const VERSION = '1.0';
  const TILE = 1000;
  const WORLD = 2048 * TILE; // canvas width in pixels
  const TOGGLE_KEY = 'h';
  const STORE_KEY = 'hover-paint:v1';
  const MAX_PATH = 60; // most pixels filled in along one mouse movement
  const CLICK_GAP_MS = 12;
  const AUTO_STEP_MS = 70; // time the auto-paint cursor takes per pixel
  const AUTO_FALLBACK_LIMIT = 500; // used when your charge count can't be read
  const TILE_TTL_MS = 15000;
  const MAX_TEMPLATE_PIXELS = 1_000_000;
  const FREE_MAX_ID = 31; // ids 1-31 are free, 32-63 have to be unlocked

  const PALETTE = [
    [1, 'Black', 0, 0, 0], [2, 'Dark Gray', 60, 60, 60], [3, 'Gray', 120, 120, 120],
    [4, 'Light Gray', 210, 210, 210], [5, 'White', 255, 255, 255], [6, 'Deep Red', 96, 0, 24],
    [7, 'Red', 237, 28, 36], [8, 'Orange', 255, 127, 39], [9, 'Gold', 246, 170, 9],
    [10, 'Yellow', 249, 221, 59], [11, 'Light Yellow', 255, 250, 188], [12, 'Dark Green', 14, 185, 104],
    [13, 'Green', 19, 230, 123], [14, 'Light Green', 135, 255, 94], [15, 'Dark Teal', 12, 129, 110],
    [16, 'Teal', 16, 174, 166], [17, 'Light Teal', 19, 225, 190], [18, 'Dark Blue', 40, 80, 158],
    [19, 'Blue', 64, 147, 228], [20, 'Cyan', 96, 247, 242], [21, 'Indigo', 107, 80, 246],
    [22, 'Light Indigo', 153, 177, 251], [23, 'Dark Purple', 120, 12, 153], [24, 'Purple', 170, 56, 185],
    [25, 'Light Purple', 224, 159, 249], [26, 'Dark Pink', 203, 0, 122], [27, 'Pink', 236, 31, 128],
    [28, 'Light Pink', 243, 141, 169], [29, 'Dark Brown', 104, 70, 52], [30, 'Brown', 149, 104, 42],
    [31, 'Beige', 248, 178, 119], [32, 'Medium Gray', 170, 170, 170], [33, 'Dark Red', 165, 14, 30],
    [34, 'Light Red', 250, 128, 114], [35, 'Dark Orange', 228, 92, 26], [36, 'Light Tan', 214, 181, 148],
    [37, 'Dark Goldenrod', 156, 132, 49], [38, 'Goldenrod', 197, 173, 49], [39, 'Light Goldenrod', 232, 212, 95],
    [40, 'Dark Olive', 74, 107, 58], [41, 'Olive', 90, 148, 74], [42, 'Light Olive', 132, 197, 115],
    [43, 'Dark Cyan', 15, 121, 159], [44, 'Light Cyan', 187, 250, 242], [45, 'Light Blue', 125, 199, 255],
    [46, 'Dark Indigo', 77, 49, 184], [47, 'Dark Slate Blue', 74, 66, 132], [48, 'Slate Blue', 122, 113, 196],
    [49, 'Light Slate Blue', 181, 174, 241], [50, 'Light Brown', 219, 164, 99], [51, 'Dark Beige', 209, 128, 81],
    [52, 'Light Beige', 255, 197, 165], [53, 'Dark Peach', 155, 82, 73], [54, 'Peach', 209, 128, 120],
    [55, 'Light Peach', 250, 182, 164], [56, 'Dark Tan', 123, 99, 82], [57, 'Tan', 156, 132, 107],
    [58, 'Dark Slate', 51, 57, 65], [59, 'Slate', 109, 117, 141], [60, 'Light Slate', 179, 185, 209],
    [61, 'Dark Stone', 109, 100, 63], [62, 'Stone', 148, 140, 107], [63, 'Light Stone', 205, 197, 158],
  ].map(([id, name, r, g, b]) => ({ id, name, r, g, b }));
  const COLOR_BY_ID = new Map(PALETTE.map((c) => [c.id, c]));
  const FREE_IDS = PALETTE.filter((c) => c.id <= FREE_MAX_ID).map((c) => c.id);

  const saved = loadSettings();
  const state = {
    src: saved.src ?? null,
    fileName: saved.fileName ?? '',
    x: saved.x ?? null,
    y: saved.y ?? null,
    opacity: saved.opacity ?? 0.5,
    width: saved.width ?? null, // chosen template width; null = the image's own size
    speed: saved.speed ?? 1, // Auto-Paint speed: 1, 2, 5 or 10 times the normal pace
    mode: saved.mode ?? 'place', // which tab is showing: 'place' (Auto Place) or 'paint' (Auto-Paint)
    srcW: 0, // the image's own size
    srcH: 0,
    ownedOnly: saved.ownedOnly ?? true,
    owned: new Set(saved.owned ?? FREE_IDS),
    ownedFromPalette: false, // the palette is the final word on which colors you have
    panelPos: saved.panelPos ?? null,
    collapsed: saved.collapsed ?? false,
    w: 0,
    h: 0,
    ids: null, // palette id for each template pixel, 0 = leave alone
    colorCount: 0,
    on: false,
    auto: false,
    autoMsg: '',
    picking: null, // {x, y} to go back to if moving the template is cancelled
    paletteOpen: false,
    paletteOpenedAt: 0,
    currentColor: null,
    charges: null, // {count, max} from your account
    placed: new Map(), // "x,y" -> when we clicked it
    placedCount: 0,
    lockedSkips: 0,
    note: '',
  };

  let lib = null; // the maplibre module the site uses
  let map = null; // the site's map
  let lastPx = null;
  const queue = [];
  let draining = false;
  // true for the map itself and anything the map draws on top of it, but not for the
  // site's panels or popups
  const onMap = (el) => !!map && map.getCanvasContainer().contains(el);

  // ---------- settings ----------

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveSettings() {
    const { src, fileName, width, speed, mode, x, y, opacity, ownedOnly, panelPos, collapsed } = state;
    const data = { src, fileName, width, speed, mode, x, y, opacity, ownedOnly, owned: [...state.owned], panelPos, collapsed };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {
      state.note = 'Could not save the image for next time (it is too big). It still works until you reload.';
    }
  }

  // ---------- your account ----------

  // Same request the site makes for itself; the browser adds your login automatically.
  async function fetchAccount() {
    try {
      const res = await fetch('https://backend.wplace.live/me', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return;
      const me = await res.json();
      if (me.charges && typeof me.charges.count === 'number') {
        state.charges = { count: Math.floor(me.charges.count), max: me.charges.max ?? null };
      }
      // bought colors: bit n stands for color id 32 + n
      if (!state.ownedFromPalette && Number.isFinite(me.extraColorsBitmap)) {
        const ids = [...FREE_IDS];
        for (let id = 32; id <= 63; id++) if (me.extraColorsBitmap & (1 << (id - 32))) ids.push(id);
        setOwned(ids);
      }
    } catch {}
    updatePanel();
  }

  function readOwnedFromPalette() {
    const ids = [];
    for (const btn of document.querySelectorAll('button[id^="color-"]')) {
      const id = Number(btn.id.slice(6));
      if (id > 0 && !isLocked(btn)) ids.push(id);
    }
    if (!ids.length) return;
    state.ownedFromPalette = true;
    setOwned(ids);
  }

  function setOwned(ids) {
    const next = new Set(ids);
    if (next.size === state.owned.size && ids.every((id) => state.owned.has(id))) return;
    state.owned = next;
    saveSettings();
    if (state.ownedOnly) buildTemplate();
    updatePanel();
  }

  const boughtCount = () => [...state.owned].filter((id) => id > FREE_MAX_ID).length;

  // ---------- finding the site's map ----------

  // The site bundles maplibre in one of its own script chunks. Walk the chunks the page
  // loaded until one exports the maplibre library, then import that same module.
  async function findMapLibre() {
    const seen = new Set();
    const todo = [];
    const add = (u) => {
      try {
        const url = new URL(u, location.href).href;
        if (url.startsWith(location.origin + '/_app/') && url.endsWith('.js') && !seen.has(url)) {
          seen.add(url);
          todo.push(url);
        }
      } catch {}
    };
    performance.getEntriesByType('resource').forEach((e) => add(e.name));
    document.querySelectorAll('link[rel="modulepreload"], script[src]').forEach((el) => add(el.href || el.src));
    document.querySelectorAll('script:not([src])').forEach((el) => {
      for (const m of el.textContent.matchAll(/["'](\/_app\/[^"']+\.js)["']/g)) add(m[1]);
    });

    while (todo.length && seen.size < 600) {
      const url = todo.shift();
      const text = await fetch(url).then((r) => r.text()).catch(() => '');
      if (text.includes('MercatorCoordinate') && text.includes('triggerRepaint')) {
        const found = await libraryFrom(url);
        if (found) return found;
      }
      for (const m of text.matchAll(/["']((?:\.{1,2}|\/_app)\/[^"']+\.js)["']/g)) add(new URL(m[1], url).href);
    }
    return null;
  }

  async function libraryFrom(url) {
    let mod;
    try {
      mod = await import(url);
    } catch {
      return null;
    }
    const isLib = (v) => v && typeof v.Map === 'function' && v.Map.prototype.unproject && v.MercatorCoordinate;
    for (const v of Object.values(mod)) {
      if (isLib(v)) return v;
      // the bundle wraps maplibre in a lazy "get the module" function
      if (typeof v === 'function' && v.length === 0 && !v.prototype?.unproject) {
        try {
          const r = v();
          if (isLib(r)) return r;
        } catch {}
      }
    }
    return null;
  }

  // Wrap the Map methods for a moment; the first time the site's map calls one of them we
  // know which object it is, and put the methods back.
  function captureMap(MapClass) {
    return new Promise((resolve) => {
      const proto = MapClass.prototype;
      const originals = {};
      const restore = () => Object.assign(proto, originals);
      for (const name of Object.getOwnPropertyNames(proto)) {
        const d = Object.getOwnPropertyDescriptor(proto, name);
        if (name === 'constructor' || typeof d.value !== 'function') continue;
        originals[name] = d.value;
        proto[name] = function (...args) {
          if (this instanceof MapClass) {
            restore();
            resolve(this);
          }
          return originals[name].apply(this, args);
        };
      }
    });
  }

  async function connect() {
    for (let attempt = 0; attempt < 30 && !lib; attempt++) {
      lib = await findMapLibre();
      if (!lib) await sleep(2000);
    }
    if (!lib) {
      state.note = 'Could not find the WPlace map. The site may have changed; try reloading.';
      return updatePanel();
    }
    updatePanel();
    map = await captureMap(lib.Map);
    map.on('move', placeOverlay);
    map.on('resize', placeOverlay);
    map.on('movestart', () => (lastPx = null));
    map.getCanvasContainer().appendChild(overlay);
    placeOverlay();
    warmTiles();
    updatePanel();
  }

  // ---------- pixel math ----------

  // Global pixel under a point on screen. Matches the pixel the site picks for a click.
  function pixelAt(clientX, clientY) {
    const r = map.getCanvas().getBoundingClientRect();
    const mc = lib.MercatorCoordinate.fromLngLat(map.unproject([clientX - r.left, clientY - r.top]));
    const x = Math.floor(mc.x * WORLD);
    return { x: ((x % WORLD) + WORLD) % WORLD, y: Math.floor(mc.y * WORLD) };
  }

  // Map-relative position of a global pixel coordinate (pixel corners are whole numbers).
  function mapPoint(gx, gy) {
    return map.project(new lib.MercatorCoordinate(gx / WORLD, gy / WORLD).toLngLat());
  }

  function clientCenterOf(gx, gy) {
    const r = map.getCanvas().getBoundingClientRect();
    const p = mapPoint(gx + 0.5, gy + 0.5);
    return { x: p.x + r.left, y: p.y + r.top, inside: p.x >= 0 && p.y >= 0 && p.x < r.width && p.y < r.height };
  }

  function linePixels(a, b) {
    const out = [];
    let { x, y } = a;
    const dx = Math.abs(b.x - x), dy = -Math.abs(b.y - y);
    const sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      out.push({ x, y });
      if ((x === b.x && y === b.y) || out.length > MAX_PATH) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
    return out.length > MAX_PATH ? [b] : out;
  }

  // ---------- template ----------

  function nearestColor(r, g, b) {
    let best = null, bestD = Infinity;
    for (const c of PALETTE) {
      if (state.ownedOnly && !state.owned.has(c.id)) continue;
      const rm = (r + c.r) / 2;
      const dr = r - c.r, dg = g - c.g, db = b - c.b;
      const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  let decoded = { src: null, img: null }; // decode once, resize many times
  async function decodeSource(src) {
    if (decoded.src !== src) {
      const img = new Image();
      img.src = src;
      await img.decode();
      decoded = { src, img };
    }
    return decoded.img;
  }

  // Largest width allowed: up to 4× the image, and never over the pixel limit.
  function maxWidth() {
    const ratio = state.srcH / state.srcW;
    return Math.max(1, Math.min(state.srcW * 4, Math.floor(Math.sqrt(MAX_TEMPLATE_PIXELS / ratio))));
  }

  // Size the template is drawn at: the chosen width (or the image's own), same shape.
  function templateSize() {
    const w = Math.max(1, Math.min(Math.round(state.width ?? state.srcW), maxWidth()));
    return { w, h: Math.max(1, Math.round((w * state.srcH) / state.srcW)) };
  }

  let buildToken = 0;
  async function buildTemplate() {
    const token = ++buildToken;
    if (!state.src) {
      state.ids = null;
      placeOverlay();
      return updatePanel();
    }
    let img;
    try {
      img = await decodeSource(state.src);
    } catch {
      state.ids = null;
      state.note = 'That file could not be read as an image.';
      return placeOverlay();
    }
    if (token !== buildToken) return; // a newer build started meanwhile
    state.srcW = img.naturalWidth;
    state.srcH = img.naturalHeight;
    const { w, h } = templateSize();
    const read = document.createElement('canvas');
    read.width = w;
    read.height = h;
    const rctx = read.getContext('2d', { willReadFrequently: true });
    // shrinking blends neighbouring pixels (good for photos); growing keeps hard pixel edges
    rctx.imageSmoothingEnabled = w < state.srcW;
    rctx.imageSmoothingQuality = 'high';
    rctx.drawImage(img, 0, 0, w, h);
    const src = rctx.getImageData(0, 0, w, h).data;

    const ids = new Uint8Array(w * h);
    const view = new ImageData(w, h);
    const cache = new Map();
    const used = new Set();
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (src[o + 3] < 128) continue;
      const key = (src[o] << 16) | (src[o + 1] << 8) | src[o + 2];
      let c = cache.get(key);
      if (!c) cache.set(key, (c = nearestColor(src[o], src[o + 1], src[o + 2])));
      ids[i] = c.id;
      used.add(c.id);
      view.data.set([c.r, c.g, c.b, 255], o);
    }
    overlay.width = w;
    overlay.height = h;
    overlay.getContext('2d').putImageData(view, 0, 0);
    Object.assign(state, { ids, w, h, colorCount: used.size });
    drawThumb();
    placeOverlay();
    warmTiles();
    updatePanel();
  }

  function templateId(gx, gy) {
    if (!state.ids || state.x == null) return 0;
    const lx = gx - state.x, ly = gy - state.y;
    if (lx < 0 || ly < 0 || lx >= state.w || ly >= state.h) return 0;
    return state.ids[ly * state.w + lx];
  }

  // ---------- overlay ----------

  const overlay = document.createElement('canvas');
  overlay.style.cssText =
    'position:absolute;left:0;top:0;pointer-events:none;image-rendering:pixelated;z-index:1;display:none;';

  function placeOverlay() {
    if (!map || !state.ids || state.x == null) {
      overlay.style.display = 'none';
      return;
    }
    const a = mapPoint(state.x, state.y);
    const b = mapPoint(state.x + state.w, state.y + state.h);
    Object.assign(overlay.style, {
      display: 'block',
      left: `${a.x}px`,
      top: `${a.y}px`,
      width: `${b.x - a.x}px`,
      height: `${b.y - a.y}px`,
      opacity: String(state.opacity),
    });
  }

  // ---------- what is on the canvas already ----------

  const tiles = new Map(); // "tx,ty" -> {data, time, loading, failed}

  function tileInfo(tx, ty) {
    const key = `${tx},${ty}`;
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { data: null, time: 0, loading: false, failed: false }));
    if (!t.loading && Date.now() - t.time > TILE_TTL_MS) {
      t.loading = true;
      fetchTile(tx, ty).then(
        (data) => Object.assign(t, { data, time: Date.now(), loading: false, failed: false }),
        () => Object.assign(t, { time: Date.now(), loading: false, failed: true }),
      );
    }
    return t;
  }

  async function fetchTile(tx, ty) {
    const res = await fetch(`https://backend.wplace.live/files/s0/tiles/${tx}/${ty}.png`, { cache: 'no-store' });
    if (res.status === 404) return 'empty'; // nobody has painted on this tile yet
    if (!res.ok) throw new Error(`tile ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  }

  function templateTiles() {
    const out = [];
    if (!state.ids || state.x == null) return out;
    for (let ty = Math.floor(state.y / TILE); ty <= Math.floor((state.y + state.h - 1) / TILE); ty++)
      for (let tx = Math.floor(state.x / TILE); tx <= Math.floor((state.x + state.w - 1) / TILE); tx++)
        out.push(tileInfo(tx, ty));
    return out;
  }

  const warmTiles = () => void templateTiles();

  async function tilesReady(timeoutMs = 5000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end && !templateTiles().every((t) => t.data || t.failed)) await sleep(150);
  }

  function refreshTilesSoon() {
    setTimeout(() => {
      for (const t of tiles.values()) t.time = 0;
      warmTiles();
    }, 2500);
  }

  function needsPaint(gx, gy, id) {
    const tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE);
    const t = tileInfo(tx, ty);
    const key = `${gx},${gy}`;
    const placedAt = state.placed.get(key);
    if (placedAt) {
      // placed while this palette is open: it is waiting for you to press Paint
      if (placedAt >= state.paletteOpenedAt) return false;
      // placed earlier: trust the canvas once it has been reloaded since
      if (t.time <= placedAt) return false;
      state.placed.delete(key);
    }
    if (t.failed && !t.data) return true; // can't check, paint it anyway
    if (!t.data) return false; // still loading; it will be ready on the next pass
    if (t.data === 'empty') return true;
    const o = ((gy % TILE) * TILE + (gx % TILE)) * 4;
    if (t.data[o + 3] === 0) return true;
    const c = COLOR_BY_ID.get(id);
    return t.data[o] !== c.r || t.data[o + 1] !== c.g || t.data[o + 2] !== c.b;
  }

  // ---------- painting ----------

  const colorButton = (id) => document.getElementById(`color-${id}`);
  const isLocked = (btn) => btn.disabled || !!btn.querySelector('svg');

  function clickMapAt(cx, cy) {
    const canvas = map.getCanvas();
    const base = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };
    const ptr = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...ptr, buttons: 1 }));
    canvas.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...ptr, buttons: 0 }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    canvas.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
  }

  // Picks the color and clicks one pixel. Returns true if it was placed.
  async function placePixel(x, y, id) {
    if (!needsPaint(x, y, id)) return false;
    const btn = colorButton(id);
    if (!btn || isLocked(btn)) {
      state.lockedSkips++;
      return false;
    }
    if (!clientCenterOf(x, y).inside) return false;
    if (state.auto) await moveGhost(x, y);
    if (state.currentColor !== id) {
      btn.click();
      state.currentColor = id;
      await nextFrame();
    }
    const p = clientCenterOf(x, y); // the map may have moved meanwhile
    if (!p.inside) return false;
    clickMapAt(p.x, p.y);
    if (state.auto) pulseGhost();
    state.placed.set(`${x},${y}`, Date.now());
    state.placedCount++;
    return true;
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length) {
        const { x, y, id } = queue.shift();
        if (!placing() || !state.paletteOpen || state.auto) {
          queue.length = 0;
          break;
        }
        if (await placePixel(x, y, id)) await sleep(CLICK_GAP_MS);
      }
    } finally {
      draining = false;
      updatePanel();
    }
  }

  // Template pixels that still need paint, row by row in a back-and-forth order, split
  // into ones on screen now and how many more are off screen.
  function pixelsToPaint() {
    const visible = [];
    let offscreen = 0;
    const r = map.getCanvas().getBoundingClientRect();
    const a = pixelAt(r.left, r.top), b = pixelAt(r.right - 1, r.bottom - 1);
    for (let ly = 0; ly < state.h; ly++) {
      const row = [];
      for (let lx = 0; lx < state.w; lx++) {
        const id = state.ids[ly * state.w + lx];
        if (!id) continue;
        const x = state.x + lx, y = state.y + ly;
        if (!needsPaint(x, y, id)) continue;
        if (x < a.x || x > b.x || y < a.y || y > b.y) offscreen++;
        else row.push({ x, y, id });
      }
      if (ly % 2) row.reverse();
      visible.push(...row);
    }
    return { visible, offscreen };
  }

  async function autoPaint() {
    if (state.auto) return stopAuto('Stopped.');
    if (!state.paletteOpen) {
      state.autoMsg = 'Open the site’s Paint palette first.';
      return updatePanel();
    }
    state.auto = true;
    state.autoMsg = 'Checking your charges and the canvas…';
    queue.length = 0;
    updatePanel();
    await Promise.all([fetchAccount(), tilesReady()]);
    let budget = state.charges ? state.charges.count : AUTO_FALLBACK_LIMIT;
    const { visible, offscreen } = pixelsToPaint();
    if (!visible.length) {
      return stopAuto(offscreen ? `Nothing left on screen. Move the map to reach ${offscreen} more.` : 'Your art is already finished here!');
    }
    let placed = 0;
    for (const p of visible) {
      if (!state.auto || !state.paletteOpen) break;
      if (budget <= 0) break;
      state.autoMsg = `Painting… ${placed} placed`;
      updatePanel();
      if (await placePixel(p.x, p.y, p.id)) {
        placed++;
        budget--;
      }
    }
    if (!state.auto) return; // stopped by you
    let msg = `Placed ${placed}. Press the site’s Paint button to send them.`;
    if (budget <= 0) msg = `Out of charges after ${placed}. Press Paint to send them.`;
    if (offscreen) msg += ` ${offscreen} more are off screen.`;
    stopAuto(msg);
  }

  function stopAuto(msg) {
    state.auto = false;
    state.autoMsg = msg;
    ghost.style.opacity = '0';
    updatePanel();
  }

  function watchPalette() {
    const open = !!document.querySelector('button[id^="color-"]');
    if (open === state.paletteOpen) return;
    state.paletteOpen = open;
    if (open) {
      state.paletteOpenedAt = Date.now();
      state.currentColor = null;
      state.placedCount = 0;
      state.lockedSkips = 0;
      state.autoMsg = '';
      readOwnedFromPalette();
      setTimeout(readOwnedFromPalette, 600); // the lock icons can arrive a moment later
      fetchAccount();
      warmTiles();
    } else {
      queue.length = 0;
      if (state.auto) stopAuto('Stopped: the paint palette closed.');
      refreshTilesSoon();
    }
    updatePanel();
  }

  // ---------- auto-paint cursor ----------

  const ghost = document.createElement('div');
  ghost.style.cssText =
    'position:fixed;left:0;top:0;z-index:2147483001;pointer-events:none;opacity:0;' +
    'transition:transform 60ms linear, opacity .2s;will-change:transform;';
  ghost.innerHTML = `
    <svg width="26" height="30" viewBox="0 0 26 30" style="display:block;overflow:visible;filter:drop-shadow(0 2px 6px rgba(2,6,23,.55)) drop-shadow(0 0 8px rgba(94,234,212,.7))">
      <defs><linearGradient id="hp-ghost" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ccfbf1"/><stop offset=".55" stop-color="#5eead4"/><stop offset="1" stop-color="#38bdf8"/>
      </linearGradient></defs>
      <path d="M1 1 L1 23 L7 17.5 L11 27 L15 25.3 L11 16 L19.5 16 Z" fill="url(#hp-ghost)" stroke="#0f172a" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>
    <span data-ring style="position:absolute;left:-9px;top:-9px;width:18px;height:18px;border-radius:50%;border:2px solid #5eead4;opacity:0"></span>`;
  const ghostRing = ghost.querySelector('[data-ring]');

  async function moveGhost(x, y) {
    const p = clientCenterOf(x, y);
    const step = AUTO_STEP_MS / state.speed;
    ghost.style.transition = `transform ${Math.round(step * 0.85)}ms linear, opacity .2s`;
    ghost.style.opacity = '1';
    ghost.style.transform = `translate(${p.x}px, ${p.y}px)`;
    await sleep(step);
  }

  function pulseGhost() {
    ghostRing.animate(
      [{ transform: 'scale(.4)', opacity: 0.9 }, { transform: 'scale(1.6)', opacity: 0 }],
      { duration: 380, easing: 'ease-out' },
    );
  }

  // ---------- input ----------

  window.addEventListener(
    'mousemove',
    (e) => {
      if (!e.isTrusted || !map) return;
      if (!onMap(e.target)) {
        lastPx = null;
        return;
      }
      const px = pixelAt(e.clientX, e.clientY);
      if (state.picking) {
        state.x = px.x;
        state.y = px.y;
        placeOverlay();
        updatePanel();
        return;
      }
      const from = lastPx;
      lastPx = px;
      if (!placing() || state.auto || !state.paletteOpen || !state.ids || e.buttons) return;
      for (const p of from ? linePixels(from, px) : [px]) {
        const id = templateId(p.x, p.y);
        if (id) queue.push({ x: p.x, y: p.y, id });
      }
      drain();
    },
    { capture: true, passive: true },
  );

  // While moving the template, the next real click on the map drops it there and the
  // site never sees that click.
  let swallowUntil = 0;
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    window.addEventListener(
      type,
      (e) => {
        if (!e.isTrusted || !onMap(e.target)) return;
        if (state.picking && (type === 'pointerdown' || type === 'mousedown')) {
          const px = pixelAt(e.clientX, e.clientY);
          state.x = px.x;
          state.y = px.y;
          state.picking = null;
          swallowUntil = Date.now() + 1000;
          saveSettings();
          placeOverlay();
          warmTiles();
          updatePanel();
        }
        if (Date.now() < swallowUntil) {
          e.stopImmediatePropagation();
          e.preventDefault();
          if (type === 'click') swallowUntil = 0;
        }
      },
      true,
    );
  }

  // Keep the selected color in sync when you pick one yourself.
  document.addEventListener(
    'click',
    (e) => {
      const btn = e.isTrusted && e.target.closest?.('button[id^="color-"]');
      if (btn) state.currentColor = Number(btn.id.slice(6));
    },
    true,
  );

  window.addEventListener('keydown', (e) => {
    const t = e.composedPath()[0];
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== 'checkbox' && t.type !== 'range')) return;
    if (e.key === 'Escape' && state.auto) {
      stopAuto('Stopped.');
    } else if (e.key === 'Escape' && state.picking) {
      cancelPicking();
    } else if (e.key.toLowerCase() === TOGGLE_KEY && !e.repeat && !state.auto) {
      // from the Auto-Paint tab, H jumps to Auto Place and turns it on
      if (state.mode !== 'place') {
        setMode('place');
        setOn(true);
      } else {
        setOn(!state.on);
      }
    }
  });

  // Auto Place only works while its tab is showing; its on/off is kept while you're on the other tab.
  const placing = () => state.on && state.mode === 'place';

  function setMode(mode) {
    if (state.auto || mode === state.mode) return;
    state.mode = mode;
    lastPx = null;
    queue.length = 0;
    saveSettings();
    updatePanel();
  }

  function setOn(on) {
    state.on = on && !!state.ids && state.x != null;
    lastPx = null;
    if (!state.on) queue.length = 0;
    else warmTiles();
    updatePanel();
  }

  function cancelPicking() {
    if (!state.picking) return;
    state.x = state.picking.x;
    state.y = state.picking.y;
    state.picking = null;
    placeOverlay();
    updatePanel();
  }

  // ---------- panel ----------

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:16px;top:160px;z-index:2147483000;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .card {
        --text: #eef3f9; --muted: #a3b2c6; --faint: rgba(226,232,240,.55);
        --line: rgba(255,255,255,.14); --accent: #5eead4; --accent2: #38bdf8;
        position: relative; width: 292px; padding: 14px; border-radius: 24px;
        overflow: hidden auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.25) transparent;
        font: 13.5px/1.45 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif;
        color: var(--text);
        background:
          linear-gradient(155deg, rgba(71,85,105,.80) 0%, rgba(30,41,59,.86) 45%, rgba(15,23,42,.92) 100%);
        backdrop-filter: blur(26px) saturate(175%);
        -webkit-backdrop-filter: blur(26px) saturate(175%);
        border: 1px solid rgba(255,255,255,.2);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.38), inset 0 -1px 0 rgba(255,255,255,.06),
          0 24px 60px rgba(2,6,23,.5), 0 2px 10px rgba(2,6,23,.35);
      }
      .card::before {
        content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
        background:
          radial-gradient(120% 50% at 0% -8%, rgba(255,255,255,.22), transparent 58%),
          radial-gradient(80% 40% at 110% 105%, rgba(94,234,212,.16), transparent 60%);
      }
      .card > * { position: relative; }

      .head { display: flex; align-items: center; gap: 10px; cursor: grab; user-select: none; }
      .head:active { cursor: grabbing; }
      .logo { width: 26px; height: 26px; border-radius: 9px; display: grid; place-items: center;
              background: linear-gradient(135deg, #5eead4, #38bdf8 55%, #818cf8);
              box-shadow: inset 0 1px 0 rgba(255,255,255,.55), 0 4px 12px rgba(56,189,248,.35); }
      .logo i { width: 10px; height: 10px; border-radius: 3px; background: rgba(15,23,42,.85);
                box-shadow: 6px 0 0 rgba(15,23,42,.45), 0 6px 0 rgba(15,23,42,.45); transform: translate(-3px,-3px); }
      .title { flex: 1; font-weight: 700; font-size: 15px; letter-spacing: .2px; }
      .title small { display: block; font-weight: 500; font-size: 11.5px; color: #b8c6d8; letter-spacing: 0; margin-top: -1px; }

      /* minmax(0, 1fr) keeps long file names from stretching the panel wider than it is */
      .body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin-top: 12px; }
      .collapsed .body { display: none; }
      .section { display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px; padding: 11px; border-radius: 18px;
                 background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
                 border: 1px solid rgba(255,255,255,.09);
                 box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }
      .label { font-size: 10.5px; font-weight: 700; letter-spacing: 1.1px; text-transform: uppercase; color: var(--faint); }
      .row { display: flex; align-items: center; gap: 10px; }
      .grow { flex: 1; min-width: 0; }
      .muted { color: var(--muted); font-size: 12.5px; }
      .ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      .btn { appearance: none; font: inherit; font-weight: 600; color: var(--text); cursor: pointer;
             height: 36px; padding: 0 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,.17); white-space: nowrap;
             background: linear-gradient(180deg, rgba(255,255,255,.16), rgba(255,255,255,.05));
             box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 1px 3px rgba(2,6,23,.3);
             transition: transform .12s ease, background .2s, border-color .2s, box-shadow .2s; }
      .btn:hover { background: linear-gradient(180deg, rgba(255,255,255,.24), rgba(255,255,255,.09)); border-color: rgba(255,255,255,.3); }
      .btn:active { transform: scale(.96); }
      .btn:disabled { opacity: .38; pointer-events: none; }
      .btn:focus-visible, .pad button:focus-visible { outline: 2px solid #7dd3fc; outline-offset: 2px; }
      .icon { width: 30px; height: 30px; padding: 0; border-radius: 50%; display: grid; place-items: center; font-size: 15px; }
      .btn.wide { width: 100%; }
      .btn.small { height: 30px; padding: 0 10px; font-size: 12.5px; border-radius: 10px; }
      .btn.danger { flex: none; width: 92px; }
      .btn.danger:hover { background: linear-gradient(180deg, rgba(251,113,133,.30), rgba(251,113,133,.12)); border-color: rgba(251,113,133,.55); }
      .btn.danger.armed { color: #fff1f2; background: linear-gradient(135deg, #f43f5e, #e11d48); border-color: rgba(255,255,255,.35);
                          box-shadow: inset 0 1px 0 rgba(255,255,255,.35), 0 6px 16px rgba(225,29,72,.35); }
      .btn.active { border-color: rgba(94,234,212,.7); box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 0 0 3px rgba(94,234,212,.18); }

      .tabs { position: relative; display: grid; grid-template-columns: 1fr 1fr; padding: 4px; border-radius: 14px;
              background: rgba(15,23,42,.55); border: 1px solid rgba(255,255,255,.12); box-shadow: inset 0 1px 4px rgba(2,6,23,.5); }
      .tabs .glow { position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px); border-radius: 10px;
                    background: linear-gradient(135deg, #2dd4bf, #38bdf8); box-shadow: inset 0 1px 0 rgba(255,255,255,.55), 0 4px 12px rgba(56,189,248,.35);
                    transition: transform .32s cubic-bezier(.3,1.3,.5,1); }
      .tabs[data-mode=paint] .glow { transform: translateX(100%); }
      .tabs button { position: relative; appearance: none; height: 34px; border: 0; background: none; cursor: pointer;
                     font: inherit; font-weight: 700; color: var(--muted); border-radius: 10px; transition: color .2s; }
      .tabs button:hover { color: var(--text); }
      .tabs button[aria-selected=true] { color: #062028; }
      .tabs button:focus-visible { outline: 2px solid #7dd3fc; outline-offset: -2px; }
      .tabs button:disabled { cursor: default; }
      .pane { display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px; }
      .pane[hidden] { display: none; }
      .speed { appearance: none; flex: none; width: 46px; height: 34px; padding: 0; border-radius: 11px; cursor: pointer;
               font: 700 13px/1 ui-monospace, "Cascadia Mono", Consolas, monospace; color: var(--text);
               border: 1px solid rgba(255,255,255,.15); background: linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.04));
               box-shadow: inset 0 1px 0 rgba(255,255,255,.2);
               transition: transform .1s, background .2s, border-color .2s, box-shadow .2s, color .2s; }
      .speed:hover { background: linear-gradient(180deg, rgba(255,255,255,.24), rgba(255,255,255,.08)); border-color: rgba(255,255,255,.28); }
      .speed:active { transform: scale(.93); }
      .speed:focus-visible { outline: 2px solid #7dd3fc; outline-offset: 2px; }
      .speed.on { color: #062028; border-color: rgba(255,255,255,.45); background: linear-gradient(135deg, #2dd4bf, #38bdf8);
                  box-shadow: inset 0 1px 0 rgba(255,255,255,.55), 0 0 0 3px rgba(94,234,212,.18), 0 4px 12px rgba(56,189,248,.35); }
      .cta { height: 48px; font-size: 15px; border-radius: 16px; color: #062028; border-color: rgba(255,255,255,.45);
             background: linear-gradient(135deg, #5eead4 0%, #38bdf8 55%, #818cf8 100%);
             box-shadow: inset 0 1px 0 rgba(255,255,255,.6), inset 0 -2px 6px rgba(15,23,42,.18), 0 8px 22px rgba(56,189,248,.35); }
      .cta:hover { background: linear-gradient(135deg, #7af0de 0%, #5cc8fa 55%, #98a2fa 100%); }
      .cta:disabled { opacity: .6; filter: saturate(.25) brightness(.9); }
      .cta.running { color: #2a0b0b; background: linear-gradient(135deg, #fda4af, #fb7185 50%, #f97316);
                     box-shadow: inset 0 1px 0 rgba(255,255,255,.6), 0 8px 22px rgba(251,113,133,.35); }

      .thumb { width: 54px; height: 54px; flex: none; border-radius: 12px; overflow: hidden; display: grid; place-items: center;
               border: 1px solid rgba(255,255,255,.18);
               background: repeating-conic-gradient(rgba(255,255,255,.10) 0 25%, rgba(255,255,255,.03) 0 50%) 0 0 / 10px 10px; }
      .thumb canvas { max-width: 100%; max-height: 100%; image-rendering: pixelated; }
      .thumb span { font-size: 22px; opacity: .55; }

      .toggle { display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }
      .toggle input { position: absolute; opacity: 0; pointer-events: none; }
      .track { flex: none; position: relative; width: 46px; height: 27px; border-radius: 99px;
               background: rgba(15,23,42,.55); border: 1px solid rgba(255,255,255,.16);
               box-shadow: inset 0 1px 4px rgba(2,6,23,.55); transition: background .25s, border-color .25s; }
      .knob { position: absolute; top: 2px; left: 2px; width: 21px; height: 21px; border-radius: 50%;
              background: radial-gradient(circle at 35% 30%, #fff, #e2e8f0 60%, #b6c3d4);
              box-shadow: 0 2px 6px rgba(2,6,23,.45), inset 0 -1px 2px rgba(15,23,42,.15);
              transition: transform .28s cubic-bezier(.3,1.5,.5,1); }
      .toggle input:checked + .track { background: linear-gradient(135deg, #2dd4bf, #38bdf8); border-color: rgba(255,255,255,.35); }
      .toggle input:checked + .track .knob { transform: translateX(19px); }
      .toggle input:focus-visible + .track { outline: 2px solid #7dd3fc; outline-offset: 2px; }
      .toggle.big { padding: 10px 12px; border-radius: 16px; border: 1px solid rgba(255,255,255,.12);
                    background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.02)); }
      .toggle.big:has(input:checked) { border-color: rgba(94,234,212,.5); background: linear-gradient(180deg, rgba(94,234,212,.16), rgba(56,189,248,.05)); }
      .toggle.big:has(input:disabled) { opacity: .45; cursor: default; }
      .toggle .name { font-weight: 650; }
      kbd { font: 600 11px/1 ui-monospace, "Cascadia Mono", Consolas, monospace; color: var(--text); padding: 4px 6px; border-radius: 6px;
            border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.08); box-shadow: inset 0 -1px 0 rgba(255,255,255,.12); }

      .pad { display: grid; grid-template-columns: repeat(3, 30px); grid-template-rows: repeat(3, 30px); gap: 3px; }
      .pad button { appearance: none; color: var(--text); font-size: 13px; cursor: pointer; border-radius: 9px; padding: 0;
                    border: 1px solid rgba(255,255,255,.15); background: linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.04));
                    box-shadow: inset 0 1px 0 rgba(255,255,255,.2); transition: transform .1s, background .2s; }
      .pad button:hover { background: linear-gradient(180deg, rgba(255,255,255,.24), rgba(255,255,255,.08)); }
      .pad button:active { transform: scale(.92); }
      .pad button:disabled { opacity: .35; pointer-events: none; }
      .pad .c { grid-area: 2 / 2; border-radius: 50%; margin: 9px; background: rgba(255,255,255,.18); }
      .coords { font: 500 12px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace; color: var(--muted); }
      .coords b { color: var(--text); font-weight: 600; }

      input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 99px; margin: 8px 0;
        background: linear-gradient(90deg, #5eead4, #38bdf8 var(--p), rgba(255,255,255,.14) var(--p)); outline: none; cursor: pointer; }
      input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, #fff, #e2e8f0 60%, #b6c3d4); border: 1px solid rgba(255,255,255,.8);
        box-shadow: 0 2px 8px rgba(2,6,23,.5), 0 0 0 5px rgba(56,189,248,.18); transition: box-shadow .2s; }
      input[type=range]:hover::-webkit-slider-thumb { box-shadow: 0 2px 8px rgba(2,6,23,.5), 0 0 0 7px rgba(56,189,248,.25); }
      input[type=range]:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px #7dd3fc; }
      .pct { font: 600 12px ui-monospace, "Cascadia Mono", Consolas, monospace; color: var(--muted); width: 36px; text-align: right; }

      .status { display: flex; gap: 9px; align-items: flex-start; padding: 10px 12px; border-radius: 14px;
                background: rgba(15,23,42,.42); border: 1px solid rgba(255,255,255,.08); font-size: 12.5px; color: #dbe5f0; }
      .dot { flex: none; width: 8px; height: 8px; margin-top: 5px; border-radius: 50%; background: #94a3b8; }
      .dot.ready { background: #5eead4; box-shadow: 0 0 0 4px rgba(94,234,212,.18); }
      .dot.busy { background: #4ade80; animation: pulse 1.1s ease-in-out infinite; }
      .dot.warn { background: #fbbf24; box-shadow: 0 0 0 4px rgba(251,191,36,.18); }
      @keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(74,222,128,.0); } 0%,100% { box-shadow: 0 0 0 2px rgba(74,222,128,.45); } }
      .chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .chip { font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 99px; color: #dbe5f0;
              background: rgba(255,255,255,.09); border: 1px solid rgba(255,255,255,.12); }
      .ver { margin-left: 6px; padding: 1px 6px; border-radius: 99px; vertical-align: 2px; font-size: 10px; font-weight: 700;
             color: var(--faint); border: 1px solid rgba(255,255,255,.16); }
      .sizer { display: grid; gap: 4px; }
      .sizer[hidden] { display: none; }
      .num { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; font-size: 11px; font-weight: 700; color: var(--faint); }
      .num input { width: 100%; min-width: 0; height: 30px; padding: 0 8px; border-radius: 10px; outline: none;
                   font: 600 12.5px ui-monospace, "Cascadia Mono", Consolas, monospace; color: var(--text);
                   background: rgba(15,23,42,.5); border: 1px solid rgba(255,255,255,.14); box-shadow: inset 0 1px 3px rgba(2,6,23,.5);
                   -moz-appearance: textfield; transition: border-color .2s, box-shadow .2s; }
      .num input:focus { border-color: rgba(94,234,212,.7); box-shadow: 0 0 0 3px rgba(94,234,212,.18); }
      .num input::-webkit-inner-spin-button, .num input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
      .link { color: var(--muted); font-size: 12px; }
      .note { color: #fcd34d; font-size: 12.5px; }
      .note:empty { display: none; }
    </style>
    <div class="card">
      <div class="head" data-drag>
        <div class="logo"><i></i></div>
        <div class="title">WPaint<span class="ver">v${VERSION}</span><small data-out="sub"></small></div>
        <button class="btn icon" data-act="collapse" title="Collapse"></button>
      </div>
      <div class="body">
        <div class="section">
          <div class="row">
            <div class="thumb"><canvas data-thumb hidden></canvas><span data-thumb-empty>🖼</span></div>
            <div class="grow">
              <div class="ellipsis" data-out="file"></div>
              <div class="muted" data-out="size"></div>
            </div>
          </div>
          <div class="row">
            <button class="btn grow" data-act="choose"></button>
            <button class="btn danger" data-act="clear" title="Take the image off the map"></button>
          </div>
          <div class="sizer" data-sizer hidden>
            <div class="row">
              <span class="muted">Size</span>
              <input class="grow" type="range" min="0" max="1000" step="1" data-in="scale">
              <span class="pct" data-out="scale"></span>
            </div>
            <div class="row">
              <label class="num">W<input type="number" min="1" data-in="w"></label>
              <span class="link" title="Width and height stay in proportion">⛓</span>
              <label class="num">H<input type="number" min="1" data-in="h"></label>
              <button class="btn small" data-act="resetSize" title="Back to the image's own size">Reset</button>
            </div>
          </div>
          <label class="toggle">
            <input type="checkbox" data-in="owned"><span class="track"><span class="knob"></span></span>
            <span class="grow">Only colors I own<div class="muted" data-out="owned"></div></span>
          </label>
        </div>

        <div class="section">
          <div class="label">Position</div>
          <div class="row">
            <div class="grow" style="display:grid;gap:8px">
              <button class="btn wide" data-act="move"></button>
              <div class="coords" data-out="pos"></div>
            </div>
            <div class="pad">
              <button data-nudge="0,-1" style="grid-area:1/2" title="Up">▲</button>
              <button data-nudge="-1,0" style="grid-area:2/1" title="Left">◀</button>
              <span class="c"></span>
              <button data-nudge="1,0" style="grid-area:2/3" title="Right">▶</button>
              <button data-nudge="0,1" style="grid-area:3/2" title="Down">▼</button>
            </div>
          </div>
          <div class="row">
            <span class="muted">Overlay</span>
            <input class="grow" type="range" min="0" max="1" step="0.05" data-in="opacity">
            <span class="pct" data-out="pct"></span>
          </div>
        </div>

        <div class="section">
          <div class="tabs" role="tablist" data-tabs>
            <span class="glow"></span>
            <button role="tab" data-mode="place">Auto Place</button>
            <button role="tab" data-mode="paint">Auto-Paint</button>
          </div>
          <div class="pane" data-pane="place">
            <label class="toggle big">
              <input type="checkbox" data-in="on"><span class="track"><span class="knob"></span></span>
              <span class="grow name">Place as I hover</span><kbd>${TOGGLE_KEY.toUpperCase()}</kbd>
            </label>
            <div class="muted">Move the mouse over your art and each pixel under it is placed for you.</div>
          </div>
          <div class="pane" data-pane="paint">
            <div class="row">
              <span class="muted grow">Speed</span>
              <button class="speed" data-speed="2" title="Twice as fast">2×</button>
              <button class="speed" data-speed="5" title="Five times as fast">5×</button>
              <button class="speed" data-speed="10" title="Ten times as fast">10×</button>
            </div>
            <button class="btn cta wide" data-act="auto"></button>
          </div>
          <div class="status"><span class="dot" data-out="dot"></span><span data-out="status"></span></div>
          <div class="chips" data-out="chips"></div>
          <div class="note" data-out="note"></div>
        </div>
      </div>
    </div>
    <input type="file" accept="image/*" hidden>`;
  const $ = (sel) => root.querySelector(sel);
  const fileInput = $('input[type=file]');
  const thumb = $('[data-thumb]');
  let clearArmed = false;

  function drawThumb() {
    thumb.hidden = !state.ids;
    $('[data-thumb-empty]').hidden = !!state.ids;
    if (!state.ids) return;
    thumb.width = state.w;
    thumb.height = state.h;
    thumb.getContext('2d').drawImage(overlay, 0, 0);
    const scale = Math.max(1, Math.floor(52 / Math.max(state.w, state.h)));
    thumb.style.width = `${state.w * scale}px`;
    thumb.style.height = `${state.h * scale}px`;
  }

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.dataset.act;
    state.note = '';
    if (act === 'collapse') {
      state.collapsed = !state.collapsed;
      saveSettings();
    } else if (act === 'choose') {
      fileInput.click();
    } else if (act === 'clear') {
      // two clicks, so one slip of the hand doesn't lose your placement
      if (!clearArmed) {
        clearArmed = true;
        setTimeout(() => {
          clearArmed = false;
          updatePanel();
        }, 3000);
      } else {
        clearArmed = false;
        if (state.auto) stopAuto('');
        Object.assign(state, { src: null, fileName: '', x: null, y: null, picking: null });
        setOn(false);
        saveSettings();
        buildTemplate().then(drawThumb);
      }
    } else if (act === 'resetSize') {
      state.width = null;
      saveSettings();
      buildTemplate();
    } else if (act === 'move') {
      if (state.picking) cancelPicking();
      else state.picking = { x: state.x, y: state.y };
    } else if (act === 'auto') {
      autoPaint();
    } else if (btn.dataset.mode) {
      setMode(btn.dataset.mode);
    } else if (btn.dataset.speed) {
      // one speed at a time; clicking the lit one goes back to normal speed
      const speed = Number(btn.dataset.speed);
      state.speed = state.speed === speed ? 1 : speed;
      saveSettings();
    } else if (btn.dataset.nudge && state.x != null) {
      const [dx, dy] = btn.dataset.nudge.split(',').map(Number);
      state.x += dx;
      state.y += dy;
      saveSettings();
      placeOverlay();
      warmTiles();
    }
    updatePanel();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      state.src = reader.result;
      state.fileName = file.name;
      state.width = null;
      state.note = '';
      await buildTemplate();
      if (state.ids && state.x == null && map) state.picking = { x: null, y: null };
      saveSettings();
      updatePanel();
    };
    reader.readAsDataURL(file);
  });

  $('[data-in=owned]').addEventListener('change', async (e) => {
    state.ownedOnly = e.target.checked;
    saveSettings();
    await buildTemplate();
  });

  $('[data-in=on]').addEventListener('change', (e) => setOn(e.target.checked));

  $('[data-in=opacity]').addEventListener('input', (e) => {
    state.opacity = Number(e.target.value);
    placeOverlay();
    saveSettings();
    updatePanel();
  });

  // The size slider is logarithmic so small sizes get as much room as big ones.
  const scaleInput = $('[data-in=scale]');
  const logMax = () => Math.log(Math.max(2, maxWidth()));
  const sliderToWidth = (v) => Math.round(Math.exp((v / 1000) * logMax()));
  const widthToSlider = (w) => Math.round((Math.log(w) / logMax()) * 1000);

  let rebuildQueued = false;
  function setWidth(w) {
    state.width = Math.max(1, Math.min(Math.round(w), maxWidth()));
    if (rebuildQueued) return;
    rebuildQueued = true; // rebuild at most once per frame while dragging
    requestAnimationFrame(() => {
      rebuildQueued = false;
      buildTemplate();
    });
  }

  scaleInput.addEventListener('input', () => setWidth(sliderToWidth(Number(scaleInput.value))));
  scaleInput.addEventListener('change', saveSettings);
  $('[data-in=w]').addEventListener('change', (e) => {
    setWidth(Number(e.target.value) || 1);
    saveSettings();
  });
  $('[data-in=h]').addEventListener('change', (e) => {
    setWidth(((Number(e.target.value) || 1) * state.srcW) / state.srcH);
    saveSettings();
  });

  // drag the panel by its header
  $('[data-drag]').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const start = host.getBoundingClientRect();
    const dx = e.clientX - start.left, dy = e.clientY - start.top;
    const move = (ev) => {
      const left = Math.min(Math.max(0, ev.clientX - dx), innerWidth - 60);
      const top = Math.min(Math.max(0, ev.clientY - dy), innerHeight - 40);
      state.panelPos = { left, top };
      applyPanelPos();
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      saveSettings();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });

  function applyPanelPos() {
    if (state.panelPos) {
      const left = Math.min(state.panelPos.left, innerWidth - 60);
      const top = Math.min(state.panelPos.top, innerHeight - 40);
      host.style.left = `${Math.max(0, left)}px`;
      host.style.top = `${Math.max(0, top)}px`;
    }
    // scroll inside the panel rather than running off the bottom of the window
    $('.card').style.maxHeight = `${Math.max(120, innerHeight - host.getBoundingClientRect().top - 12)}px`;
  }

  function statusLine() {
    if (!lib) return ['', 'Connecting to the map…'];
    if (!map) return ['warn', 'Move or zoom the map once to connect.'];
    if (!state.ids) return ['', 'Choose an image to start.'];
    if (state.picking) return ['ready', 'Move over the map and click where the top-left corner goes.'];
    if (state.x == null) return ['', 'Use “Move template” to place it.'];
    if (state.auto) return ['busy', state.autoMsg];
    if (state.mode === 'paint') {
      if (state.autoMsg) return ['ready', state.autoMsg];
      if (!state.paletteOpen) return ['', 'Open the site’s Paint palette, then press Auto-Paint.'];
      return ['ready', 'Press Auto-Paint when you’re ready.'];
    }
    if (!state.paletteOpen) return ['', 'Open the site’s Paint palette to start painting.'];
    if (!state.on) return ['ready', 'Turn on “Place as I hover” to start.'];
    return ['busy', `Placed ${state.placedCount} this round. Press the site’s Paint button to send them.`];
  }

  function updatePanel() {
    $('.card').classList.toggle('collapsed', state.collapsed);
    $('[data-act=collapse]').textContent = state.collapsed ? '▾' : '▴';
    $('[data-out=sub]').textContent = placing() ? 'Auto Place on' : state.auto ? 'Auto-Painting' : map ? 'Ready' : 'Starting…';

    $('[data-tabs]').dataset.mode = state.mode;
    root.querySelectorAll('button[data-mode]').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.mode === state.mode));
      b.disabled = state.auto; // finish or stop Auto-Paint before switching
    });
    root.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== state.mode));

    $('[data-out=file]').textContent = state.ids ? state.fileName || 'Image' : 'No image yet';
    $('[data-out=size]').textContent = state.ids ? `${state.w} × ${state.h} · ${state.colorCount} colors` : 'PNG works best';
    $('[data-out=file]').title = state.fileName;
    $('[data-act=choose]').textContent = state.src ? 'Change image…' : 'Choose image…';
    const clear = $('[data-act=clear]');
    clear.disabled = !state.src;
    clear.classList.toggle('armed', clearArmed);
    clear.textContent = clearArmed ? 'Remove?' : 'Remove';

    $('[data-sizer]').hidden = !state.ids;
    if (state.ids) {
      // leave whichever control you're using alone so it doesn't jump under your hand
      const focused = root.activeElement;
      if (focused !== scaleInput) scaleInput.value = widthToSlider(state.w);
      scaleInput.style.setProperty('--p', `${scaleInput.value / 10}%`);
      $('[data-out=scale]').textContent = `${Math.round((state.w / state.srcW) * 100)}%`;
      const wIn = $('[data-in=w]'), hIn = $('[data-in=h]');
      if (focused !== wIn) wIn.value = state.w;
      if (focused !== hIn) hIn.value = state.h;
      $('[data-act=resetSize]').disabled = state.w === state.srcW;
    }

    $('[data-in=owned]').checked = state.ownedOnly;
    const bought = boughtCount();
    $('[data-out=owned]').textContent = state.ownedOnly
      ? `${state.owned.size} colors · ${bought ? `${bought} bought` : 'free set'}${state.ownedFromPalette ? '' : ' · open palette to check'}`
      : 'Using all 63 colors';

    const move = $('[data-act=move]');
    move.disabled = !state.ids || !map || state.auto;
    move.textContent = state.picking ? 'Cancel move' : 'Move template';
    move.classList.toggle('active', !!state.picking);
    root.querySelectorAll('[data-nudge]').forEach((b) => (b.disabled = state.x == null || state.auto));
    root.querySelectorAll('[data-speed]').forEach((b) => {
      const on = Number(b.dataset.speed) === state.speed;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $('[data-out=pos]').innerHTML =
      state.x == null
        ? 'Not placed yet'
        : `Tile <b>${Math.floor(state.x / TILE)}, ${Math.floor(state.y / TILE)}</b><br>Pixel <b>${state.x % TILE}, ${state.y % TILE}</b>`;

    const range = $('[data-in=opacity]');
    range.value = state.opacity;
    range.style.setProperty('--p', `${state.opacity * 100}%`);
    $('[data-out=pct]').textContent = `${Math.round(state.opacity * 100)}%`;

    const ready = !!state.ids && state.x != null && !!map;
    const onBox = $('[data-in=on]');
    onBox.checked = state.on;
    onBox.disabled = !ready;
    const auto = $('[data-act=auto]');
    auto.disabled = !ready;
    auto.classList.toggle('running', state.auto);
    auto.textContent = state.auto ? '■  Stop Auto-Paint  (Esc)' : '✦  Auto-Paint';

    const [kind, text] = statusLine();
    $('[data-out=dot]').className = `dot ${kind}`;
    $('[data-out=status]').textContent = text;

    const chips = [];
    if (state.charges) chips.push(`⚡ ${state.charges.count}${state.charges.max ? ` / ${state.charges.max}` : ''} charges`);
    if (state.paletteOpen && state.placedCount) chips.push(`${state.placedCount} pending`);
    if (state.paletteOpen && state.lockedSkips) chips.push(`${state.lockedSkips} need locked colors`);
    $('[data-out=chips]').innerHTML = chips.map((c) => `<span class="chip">${c}</span>`).join('');
    $('[data-out=note]').textContent = state.note;
  }

  // ---------- helpers & start ----------

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Waits for the next frame, or a short timer when frames are paused (a background tab).
  function nextFrame() {
    return new Promise((r) => {
      requestAnimationFrame(() => r());
      setTimeout(r, 40);
    });
  }

  document.body.append(host, ghost);
  applyPanelPos();
  addEventListener('resize', applyPanelPos);
  drawThumb();
  updatePanel();
  buildTemplate();
  setInterval(watchPalette, 300);
  fetchAccount();
  connect();
})();
