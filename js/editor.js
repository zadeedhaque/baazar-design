// Baazar flyer editor: selection, dragging, resizing, properties, layers, history and export.
(function () {
  'use strict';
  const R = window.BZRender;
  const $ = (s, r = document) => r.querySelector(s);
  const STORE_KEY = 'baazar-flyer-editor-v1';
  const PX = 4 / 3; // CSS px per point at 100% zoom

  const svg = $('#page');
  const content = $('#content');
  const overlay = $('#overlay');

  let doc;
  let sel = [];
  let focusGroup = null;
  let hoverId = null;
  let zoom = 1;
  let drag = null;
  let guides = [];
  let clipboard = null;
  let undoStack = [], redoStack = [], lastSnap = null;
  let replaceTarget = null; // element id whose image/icon is being replaced
  let lastDown = null;

  // ---------------------------------------------------------------- utilities
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const byId = (id) => doc.elements.find((e) => e.id === id);
  const selected = () => sel.map(byId).filter(Boolean);
  const uid = () => {
    let id;
    do { id = 'e' + Math.random().toString(36).slice(2, 8); } while (doc && byId(id));
    return id;
  };
  const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(kid));
    return n;
  };

  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function download(blob, name) {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------------------------------------------------------------- images
  const imgCache = new Map();

  function imageData(src) {
    if (!src) return null;
    if (src.startsWith('asset:')) return window.BZ_ASSETS.images[src.slice(6)] || null;
    if (src.startsWith('upload:')) return (doc.assets || {})[src.slice(7)] || null;
    return src;
  }

  function dataUrlToBlobUrl(data) {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(data);
    if (!m) return data;
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: m[1] }));
  }

  function imageEntry(src) {
    if (imgCache.has(src)) return imgCache.get(src);
    const data = imageData(src);
    if (!data) return null;
    const entry = { url: dataUrlToBlobUrl(data), w: 0, h: 0 };
    imgCache.set(src, entry);
    const im = new Image();
    im.onload = () => { entry.w = im.naturalWidth; entry.h = im.naturalHeight; scheduleRender(); };
    im.src = entry.url;
    return entry;
  }

  const editorResolve = (src) => (imageEntry(src) || {}).url || null;
  const exportResolve = (src) => imageData(src);
  const imageSize = (src) => {
    const e = imageEntry(src);
    return e && e.w ? { w: e.w, h: e.h } : null;
  };

  // Shrink very large uploads so projects stay light enough to autosave.
  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = reject;
      fr.onload = () => {
        const url = fr.result;
        if (file.type === 'image/svg+xml') { resolve(url); return; }
        const im = new Image();
        im.onerror = () => resolve(url);
        im.onload = () => {
          const max = 2600;
          const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
          if (s >= 1 && file.size < 1.5e6) { resolve(url); return; }
          const c = document.createElement('canvas');
          c.width = Math.round(im.naturalWidth * s);
          c.height = Math.round(im.naturalHeight * s);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          const png = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif';
          resolve(c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9));
        };
        im.src = url;
      };
      fr.readAsDataURL(file);
    });
  }

  // ---------------------------------------------------------------- fonts
  const FONT_WEIGHTS = {};
  for (const f of window.BZ_FONTS) {
    (FONT_WEIGHTS[f.family] = FONT_WEIGHTS[f.family] || new Set()).add(f.weight);
  }
  const SYSTEM_FONTS = ['Arial', 'Helvetica', 'Verdana', 'Georgia', 'Times New Roman', 'Impact'];

  function fontList() {
    const up = (doc.fonts || []).map((f) => f.family);
    return [...Object.keys(FONT_WEIGHTS), ...up, ...SYSTEM_FONTS];
  }

  function weightsFor(family) {
    if (FONT_WEIGHTS[family]) return [...FONT_WEIGHTS[family]].sort((a, b) => a - b);
    return [400, 700];
  }

  function injectFonts() {
    let st = $('#bz-fonts');
    if (!st) { st = h('style', { id: 'bz-fonts' }); document.head.append(st); }
    st.textContent = R.fontFaceCss(null, doc.fonts || []);
  }

  // ---------------------------------------------------------------- document & history
  function freshDoc() {
    const d = clone(window.BZ_TEMPLATE);
    d.fonts = [];
    d.assets = {};
    return d;
  }

  function loadDoc() {
    try {
      const s = localStorage.getItem(STORE_KEY);
      if (s) {
        const d = JSON.parse(s);
        if (d && Array.isArray(d.elements)) return Object.assign({ fonts: [], assets: {} }, d);
      }
    } catch (e) { /* storage unavailable */ }
    return freshDoc();
  }

  let persistTimer = null;
  let warnedStorage = false;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(doc));
      } catch (e) {
        if (!warnedStorage) {
          warnedStorage = true;
          toast('Autosave is full (large images). Use Export ▸ Save project to keep your work.', 5000);
        }
      }
    }, 300);
  }

  const snapshot = () => JSON.stringify({ background: doc.background, elements: doc.elements });

  function resetHistory() {
    undoStack = [];
    redoStack = [];
    lastSnap = snapshot();
    updateUndo();
  }

  function commit() {
    const s = snapshot();
    if (s === lastSnap) return;
    undoStack.push(lastSnap);
    if (undoStack.length > 200) undoStack.shift();
    redoStack = [];
    lastSnap = s;
    persist();
    updateUndo();
  }

  function restore(s) {
    const o = JSON.parse(s);
    doc.background = o.background;
    doc.elements = o.elements;
    sel = sel.filter((id) => byId(id));
    persist();
    renderAll();
    updateUndo();
  }

  function undo() {
    commit();
    if (!undoStack.length) return;
    redoStack.push(lastSnap);
    lastSnap = undoStack.pop();
    restore(lastSnap);
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(lastSnap);
    lastSnap = redoStack.pop();
    restore(lastSnap);
  }

  function updateUndo() {
    $('#undoBtn').disabled = !undoStack.length;
    $('#redoBtn').disabled = !redoStack.length;
  }

  // ---------------------------------------------------------------- rendering
  let rafPending = false;
  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; renderCanvas(); });
  }

  function renderCanvas() {
    const { defs, body } = R.renderDoc(doc, { editor: true, resolveImage: editorResolve, imageSize });
    $('#defs').innerHTML = defs;
    content.innerHTML = body;
    drawOverlay();
  }

  function renderAll() {
    renderCanvas();
    renderLayers();
    renderProps();
  }

  function setZoom(z) {
    zoom = Math.max(0.2, Math.min(6, z));
    svg.setAttribute('viewBox', `0 0 ${doc.width} ${doc.height}`);
    svg.setAttribute('width', doc.width * zoom * PX);
    svg.setAttribute('height', doc.height * zoom * PX);
    $('#zoomLabel').textContent = Math.round(zoom * 100) + '%';
    drawOverlay();
  }

  function zoomFit() {
    const st = $('#stage');
    const z = Math.min((st.clientWidth - 64) / (doc.width * PX), (st.clientHeight - 64) / (doc.height * PX));
    setZoom(z);
  }

  // ---------------------------------------------------------------- geometry
  function corners(el) {
    const b = R.bounds(el);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const a = ((el.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => {
      const dx = x - cx, dy = y - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    });
  }

  function aabb(els) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of els) {
      for (const [x, y] of corners(el)) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function toDoc(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  const unit = () => 1 / (zoom * PX); // one screen pixel in document units

  function groupMembers(g) {
    return doc.elements.filter((e) => e.group === g && !e.hidden && !e.locked).map((e) => e.id);
  }

  function vbAspect(source) {
    const m = /viewBox="([^"]+)"/.exec(source || '');
    if (!m) return 1;
    const p = m[1].trim().split(/[\s,]+/).map(Number);
    return p[3] ? p[2] / p[3] : 1;
  }

  // ---------------------------------------------------------------- overlay
  const HANDLES = {
    nw: [-1, -1, 'nwse-resize'], n: [0, -1, 'ns-resize'], ne: [1, -1, 'nesw-resize'], e: [1, 0, 'ew-resize'],
    se: [1, 1, 'nwse-resize'], s: [0, 1, 'ns-resize'], sw: [-1, 1, 'nesw-resize'], w: [-1, 0, 'ew-resize'],
  };

  function drawOverlay() {
    const u = unit();
    const parts = [];
    const els = selected().filter((e) => !e.hidden);
    if (hoverId && !sel.includes(hoverId) && !drag) {
      const he = byId(hoverId);
      if (he) parts.push(`<polygon class="hover-box" points="${corners(he).map((p) => p.join(',')).join(' ')}"/>`);
    }
    for (const el of els) {
      parts.push(`<polygon class="sel-box" points="${corners(el).map((p) => p.join(',')).join(' ')}"/>`);
    }
    const hs = 8 * u;
    const handle = (name, x, y, cursor) =>
      `<rect class="handle" data-handle="${name}" x="${x - hs / 2}" y="${y - hs / 2}" width="${hs}" height="${hs}" rx="${hs / 4}" style="cursor:${cursor}"/>`;
    if (els.length === 1 && !els[0].locked) {
      const el = els[0];
      const b = R.bounds(el);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const a = ((el.rotation || 0) * Math.PI) / 180;
      const rot = (x, y) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)];
      for (const [name, [sx, sy, cursor]] of Object.entries(HANDLES)) {
        if (el.type === 'text' && sy !== 0 && sx === 0) continue;
        const [x, y] = rot(cx + (sx * b.w) / 2, cy + (sy * b.h) / 2);
        parts.push(handle(name, x, y, cursor));
      }
      const [tx, ty] = rot(cx, b.y);
      const [rx, ry] = rot(cx, b.y - 22 * u);
      parts.push(`<line class="sel-box" x1="${tx}" y1="${ty}" x2="${rx}" y2="${ry}"/>`);
      parts.push(`<circle class="handle" data-handle="rotate" cx="${rx}" cy="${ry}" r="${5 * u}" style="cursor:grab"/>`);
    } else if (els.length > 1) {
      const b = aabb(els);
      parts.push(`<rect class="group-box" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>`);
      for (const name of ['nw', 'ne', 'se', 'sw']) {
        const [sx, sy, cursor] = HANDLES[name];
        parts.push(handle(name, b.x + ((sx + 1) / 2) * b.w, b.y + ((sy + 1) / 2) * b.h, cursor));
      }
    }
    for (const g of guides) {
      parts.push(g.axis === 'x'
        ? `<line class="guide" x1="${g.v}" y1="0" x2="${g.v}" y2="${doc.height}"/>`
        : `<line class="guide" x1="0" y1="${g.v}" x2="${doc.width}" y2="${g.v}"/>`);
    }
    if (drag && drag.type === 'marquee' && drag.rect) {
      const r = drag.rect;
      parts.push(`<rect class="marquee" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`);
    }
    overlay.innerHTML = parts.join('');
  }

  // ---------------------------------------------------------------- pointer interaction
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // Stops the browser moving focus on mousedown, which would close the inline text editor
    // straight after a double-click opens it. Blur manually so property fields still commit.
    e.preventDefault();
    if (document.activeElement && document.activeElement !== document.body && document.activeElement.id !== 'inlineEditor') document.activeElement.blur();
    closeInlineEditor();
    const p = toDoc(e);
    const handleEl = e.target.closest('[data-handle]');
    if (handleEl) {
      startHandleDrag(handleEl.dataset.handle, p, e);
      svg.setPointerCapture(e.pointerId);
      return;
    }
    const g = e.target.closest('#content [data-id]');
    // Detect double-clicks ourselves: the canvas is redrawn between clicks, so the
    // browser's dblclick event never sees the same element twice.
    const now = performance.now();
    const isDouble = g && lastDown && lastDown.id === g.dataset.id && now - lastDown.t < 450 &&
      Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 6;
    lastDown = g ? { id: g.dataset.id, t: now, x: e.clientX, y: e.clientY } : null;
    if (isDouble) {
      lastDown = null;
      onDoubleClick(byId(g.dataset.id));
      return;
    }
    if (g) {
      const el = byId(g.dataset.id);
      if (focusGroup && el.group !== focusGroup) focusGroup = null;
      const ids = el.group && focusGroup !== el.group && !e.altKey ? groupMembers(el.group) : [el.id];
      if (e.shiftKey) {
        const all = ids.every((id) => sel.includes(id));
        sel = all ? sel.filter((id) => !ids.includes(id)) : [...new Set([...sel, ...ids])];
      } else if (!sel.includes(el.id)) {
        sel = ids;
      }
      const movers = selected().filter((x) => !x.locked);
      drag = { type: 'move', p0: p, moved: false, orig: movers.map((x) => ({ id: x.id, x: x.x, y: x.y })), box: aabb(movers) };
      renderLayers();
      renderProps();
    } else {
      if (!e.shiftKey) sel = [];
      focusGroup = null;
      drag = { type: 'marquee', p0: p, base: e.shiftKey ? [...sel] : [] };
      renderLayers();
      renderProps();
    }
    svg.setPointerCapture(e.pointerId);
    drawOverlay();
  });

  function startHandleDrag(name, p, e) {
    const els = selected();
    if (name === 'rotate') {
      const el = els[0];
      const b = R.bounds(el);
      drag = { type: 'rotate', id: el.id, c: [b.x + b.w / 2, b.y + b.h / 2] };
      return;
    }
    if (els.length === 1) {
      drag = { type: 'resize', handle: name, p0: p, orig: clone(els[0]), id: els[0].id, origH: R.bounds(els[0]).h };
    } else {
      drag = { type: 'scale', handle: name, p0: p, box: aabb(els), orig: clone(els) };
    }
  }

  svg.addEventListener('pointermove', (e) => {
    if (!drag) {
      const g = e.target.closest('#content [data-id]');
      const id = g ? g.dataset.id : null;
      if (id !== hoverId) { hoverId = id; drawOverlay(); }
      return;
    }
    const p = toDoc(e);
    if (drag.type === 'move') doMove(p, e);
    else if (drag.type === 'resize') doResize(p, e);
    else if (drag.type === 'scale') doScale(p, e);
    else if (drag.type === 'rotate') doRotate(p, e);
    else if (drag.type === 'marquee') doMarquee(p);
  });

  function endDrag() {
    if (!drag) return;
    const changed = drag.moved || drag.type === 'resize' || drag.type === 'scale' || drag.type === 'rotate';
    drag = null;
    guides = [];
    if (changed) commit();
    renderCanvas();
    renderLayers();
    renderProps();
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('pointerleave', () => { if (!drag && hoverId) { hoverId = null; drawOverlay(); } });

  function snapTargets(excludeIds) {
    const xs = [0, doc.width / 2, doc.width], ys = [0, doc.height / 2, doc.height];
    for (const el of doc.elements) {
      if (el.hidden || excludeIds.includes(el.id)) continue;
      const b = aabb([el]);
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    return { xs, ys };
  }

  function doMove(p, e) {
    let dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3 * unit()) return;
    drag.moved = true;
    guides = [];
    if (!e.altKey && drag.orig.length) {
      if (!drag.targets) drag.targets = snapTargets(drag.orig.map((o) => o.id));
      const tol = 6 * unit();
      const b = drag.box;
      const best = (cands, vals) => {
        let bestD = tol, bestV = null, bestT = null;
        for (const v of vals) for (const t of cands) {
          const d = Math.abs(t - v);
          if (d < bestD) { bestD = d; bestV = v; bestT = t; }
        }
        return bestT == null ? null : { shift: bestT - bestV, at: bestT };
      };
      const sx = best(drag.targets.xs, [b.x + dx, b.x + dx + b.w / 2, b.x + dx + b.w]);
      if (sx) { dx += sx.shift; guides.push({ axis: 'x', v: sx.at }); }
      const sy = best(drag.targets.ys, [b.y + dy, b.y + dy + b.h / 2, b.y + dy + b.h]);
      if (sy) { dy += sy.shift; guides.push({ axis: 'y', v: sy.at }); }
    }
    if (e.shiftKey) {
      if (Math.abs(p.x - drag.p0.x) > Math.abs(p.y - drag.p0.y)) dy = 0; else dx = 0;
    }
    for (const o of drag.orig) {
      const el = byId(o.id);
      el.x = round(o.x + dx);
      el.y = round(o.y + dy);
    }
    scheduleRender();
  }

  function doResize(p, e) {
    const o = drag.orig;
    const el = byId(drag.id);
    const [sx, sy] = HANDLES[drag.handle];
    const a = ((o.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    const gx = p.x - drag.p0.x, gy = p.y - drag.p0.y;
    const lx = gx * cos + gy * sin, ly = -gx * sin + gy * cos;
    const fromCenter = e.altKey;
    const k = fromCenter ? 2 : 1;
    const oh = drag.origH;
    let w = o.w + sx * lx * k;
    let hh = oh + sy * ly * k;
    const corner = sx !== 0 && sy !== 0;
    const lockAspect = corner && (o.type === 'image' || o.type === 'vector' || o.type === 'text' ? !e.shiftKey : e.shiftKey);
    if (lockAspect) {
      const s = Math.abs(w / o.w - 1) > Math.abs(hh / oh - 1) ? w / o.w : hh / oh;
      w = o.w * s;
      hh = oh * s;
    }
    w = Math.max(2, w);
    hh = Math.max(2, hh);
    if (o.type === 'text') {
      if (corner) {
        const s = w / o.w;
        el.size = round(Math.max(1, o.size * s));
      }
      el.w = round(w);
      hh = R.textHeight(el);
    } else {
      el.w = round(w);
      el.h = round(hh);
    }
    const dw = el.w - o.w, dh = hh - oh;
    const shx = fromCenter ? 0 : (sx * dw) / 2, shy = fromCenter ? 0 : (sy * dh) / 2;
    const cx = o.x + o.w / 2 + shx * cos - shy * sin;
    const cy = o.y + oh / 2 + shx * sin + shy * cos;
    el.x = round(cx - el.w / 2);
    el.y = round(cy - hh / 2);
    scheduleRender();
  }

  function doScale(p, e) {
    const b = drag.box;
    const [sx, sy] = HANDLES[drag.handle];
    const ax = sx > 0 ? b.x : b.x + b.w, ay = sy > 0 ? b.y : b.y + b.h;
    const nw = Math.abs(p.x - ax), nh = Math.abs(p.y - ay);
    const s = Math.max(0.05, e.shiftKey ? nw / b.w : Math.max(nw / b.w, nh / b.h));
    for (const o of drag.orig) {
      const el = byId(o.id);
      el.x = round(ax + (o.x - ax) * s);
      el.y = round(ay + (o.y - ay) * s);
      el.w = round(o.w * s);
      if (o.type === 'text') el.size = round(o.size * s);
      else el.h = round(o.h * s);
      if (o.radius) el.radius = round(o.radius * s);
    }
    scheduleRender();
  }

  function doRotate(p, e) {
    const el = byId(drag.id);
    let ang = (Math.atan2(p.y - drag.c[1], p.x - drag.c[0]) * 180) / Math.PI + 90;
    if (e.shiftKey) ang = Math.round(ang / 15) * 15;
    else for (const t of [0, 90, 180, 270, 360, -90]) if (Math.abs(ang - t) < 3) ang = t;
    ang = ((ang % 360) + 540) % 360 - 180;
    el.rotation = round(ang, 1);
    scheduleRender();
  }

  function doMarquee(p) {
    const x = Math.min(p.x, drag.p0.x), y = Math.min(p.y, drag.p0.y);
    const r = { x, y, w: Math.abs(p.x - drag.p0.x), h: Math.abs(p.y - drag.p0.y) };
    drag.rect = r;
    if (r.w < 2 * unit() && r.h < 2 * unit()) return;
    const hit = doc.elements.filter((el) => {
      if (el.hidden || el.locked) return false;
      const b = aabb([el]);
      return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
    }).map((el) => el.id);
    sel = [...new Set([...drag.base, ...hit])];
    drawOverlay();
  }

  function onDoubleClick(el) {
    if (!el) return;
    if (el.group) focusGroup = el.group;
    sel = [el.id];
    renderLayers();
    renderProps();
    drawOverlay();
    if (el.type === 'text') openInlineEditor(el);
    else if (el.type === 'image') pickImage(el.id);
    else if (el.type === 'vector') openIconPicker(el.id);
  }

  // ---------------------------------------------------------------- inline text editing
  let inlineId = null;
  function openInlineEditor(el) {
    const ta = $('#inlineEditor');
    inlineId = el.id;
    const s = zoom * PX;
    const b = R.bounds(el);
    const off = { x: svg.offsetLeft, y: svg.offsetTop };
    const pad = 6;
    Object.assign(ta.style, {
      left: off.x + b.x * s - pad + 'px',
      top: off.y + b.y * s + 'px',
      width: Math.max(b.w * s, 80) + pad * 2 + 'px',
      height: b.h * s + 8 + 'px',
      fontFamily: `'${el.font}', sans-serif`,
      fontSize: el.size * s + 'px',
      fontWeight: el.weight,
      fontStyle: el.italic ? 'italic' : 'normal',
      lineHeight: el.lineHeight,
      letterSpacing: (el.letterSpacing || 0) + 'em',
      textAlign: el.align,
      textTransform: el.uppercase ? 'uppercase' : 'none',
      paddingLeft: pad + 'px',
      paddingRight: pad + 'px',
      transform: el.rotation ? `rotate(${el.rotation}deg)` : '',
    });
    ta.value = el.text;
    ta.hidden = false;
    ta.focus();
    ta.select();
  }

  $('#inlineEditor').addEventListener('input', (e) => {
    const el = byId(inlineId);
    if (!el) return;
    el.text = e.target.value;
    e.target.style.height = R.textHeight(el) * zoom * PX + 8 + 'px';
    scheduleRender();
  });
  $('#inlineEditor').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); closeInlineEditor(); }
    e.stopPropagation();
  });
  $('#inlineEditor').addEventListener('blur', () => closeInlineEditor());

  function closeInlineEditor() {
    const ta = $('#inlineEditor');
    if (ta.hidden) return;
    ta.hidden = true;
    inlineId = null;
    commit();
    renderAll();
  }

  // ---------------------------------------------------------------- element operations
  function insertNew(el) {
    el.id = uid();
    doc.elements.push(el);
    sel = [el.id];
    focusGroup = null;
    commit();
    renderAll();
    return el;
  }

  function center(w, hgt) {
    const st = $('#stage');
    const r = svg.getBoundingClientRect();
    const sr = st.getBoundingClientRect();
    const cx = ((sr.left + sr.width / 2 - r.left) / r.width) * doc.width;
    const cy = ((sr.top + sr.height / 2 - r.top) / r.height) * doc.height;
    const x = Math.max(0, Math.min(doc.width - w, cx - w / 2));
    const y = Math.max(0, Math.min(doc.height - hgt, cy - hgt / 2));
    return { x: round(x), y: round(y) };
  }

  const base = (type, name, w, hgt) => Object.assign({ type, name, rotation: 0, opacity: 1, locked: false, hidden: false, w, h: hgt }, center(w, hgt));

  function addText() {
    const el = Object.assign(base('text', 'Text', 200, 30), {
      text: 'Your text here', font: 'Poppins', size: 24, weight: 700, italic: false, fill: '#0b4331',
      align: 'center', letterSpacing: 0, lineHeight: 1.15, uppercase: false, fitWidth: false,
    });
    insertNew(el);
    openInlineEditor(el);
  }

  function addRect(type) {
    const el = type === 'rect'
      ? Object.assign(base('rect', 'Rectangle', 140, 90), { fill: '#0b4331', radius: 10, stroke: 'none', strokeWidth: 0 })
      : Object.assign(base('ellipse', 'Circle', 90, 90), { fill: '#f4bf5e', stroke: 'none', strokeWidth: 0 });
    insertNew(el);
  }

  function addImage(dataKey, iw, ih) {
    const s = Math.min(1, 220 / Math.max(iw, ih));
    const el = Object.assign(base('image', 'Image', round(iw * s), round(ih * s)), {
      src: 'upload:' + dataKey, fit: 'cover', radius: 0, zoom: 1, panX: 0, panY: 0, fadeTop: 0, fadeBottom: 0, fadeLeft: 0, fadeRight: 0,
    });
    insertNew(el);
  }

  function addVector(svgKey, name) {
    const src = R.vectorSource({ svg: svgKey });
    const asp = vbAspect(src);
    const w = svgKey.startsWith('icon:') ? 48 : 120;
    const el = Object.assign(base('vector', name, w, round(w / asp)), { svg: svgKey, color: '#0b4331', strokeWidth: 2 });
    insertNew(el);
  }

  function deleteSel() {
    if (!sel.length) return;
    doc.elements = doc.elements.filter((e) => !sel.includes(e.id));
    sel = [];
    commit();
    renderAll();
  }

  function pasteElements(items, offset) {
    const groupMap = {};
    const fresh = items.map((o) => {
      const el = clone(o);
      el.id = uid();
      el.x = round(el.x + offset);
      el.y = round(el.y + offset);
      if (el.group) el.group = groupMap[el.group] || (groupMap[el.group] = el.group.replace(/-copy\d+$/, '') + '-copy' + Math.floor(Math.random() * 1e4));
      return el;
    });
    const idx = Math.max(-1, ...sel.map((id) => doc.elements.findIndex((e) => e.id === id)));
    doc.elements.splice(idx >= 0 ? idx + 1 : doc.elements.length, 0, ...fresh);
    sel = fresh.map((e) => e.id);
    focusGroup = null;
    commit();
    renderAll();
  }

  function duplicateSel() {
    if (sel.length) pasteElements(doc.elements.filter((e) => sel.includes(e.id)), 10);
  }

  function reorder(mode) {
    if (!sel.length) return;
    const list = doc.elements;
    const isSel = (e) => sel.includes(e.id);
    if (mode === 'front') doc.elements = [...list.filter((e) => !isSel(e)), ...list.filter(isSel)];
    else if (mode === 'back') doc.elements = [...list.filter(isSel), ...list.filter((e) => !isSel(e))];
    else if (mode === 'forward') {
      for (let i = list.length - 2; i >= 0; i--) if (isSel(list[i]) && !isSel(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]];
    } else if (mode === 'backward') {
      for (let i = 1; i < list.length; i++) if (isSel(list[i]) && !isSel(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]];
    }
    commit();
    renderAll();
  }

  function align(mode) {
    const els = selected().filter((e) => !e.locked);
    if (!els.length) return;
    const ref = els.length === 1 ? { x: 0, y: 0, w: doc.width, h: doc.height } : aabb(els);
    for (const el of els) {
      const b = aabb([el]);
      if (mode === 'left') el.x += ref.x - b.x;
      if (mode === 'hcenter') el.x += ref.x + ref.w / 2 - (b.x + b.w / 2);
      if (mode === 'right') el.x += ref.x + ref.w - (b.x + b.w);
      if (mode === 'top') el.y += ref.y - b.y;
      if (mode === 'vcenter') el.y += ref.y + ref.h / 2 - (b.y + b.h / 2);
      if (mode === 'bottom') el.y += ref.y + ref.h - (b.y + b.h);
      el.x = round(el.x);
      el.y = round(el.y);
    }
    commit();
    renderAll();
  }

  function distribute(axis) {
    const els = selected().filter((e) => !e.locked);
    if (els.length < 3) { toast('Select three or more elements to distribute.'); return; }
    const key = axis === 'x' ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h';
    const items = els.map((el) => ({ el, b: aabb([el]) })).sort((a, b) => a.b[key] - b.b[key]);
    const total = items.reduce((s, i) => s + i.b[size], 0);
    const first = items[0].b, last = items[items.length - 1].b;
    const gap = (last[key] + last[size] - first[key] - total) / (items.length - 1);
    let pos = first[key];
    for (const it of items) {
      it.el[key] = round(it.el[key] + (pos - it.b[key]));
      pos += it.b[size] + gap;
    }
    commit();
    renderAll();
  }

  function groupSel() {
    if (sel.length < 2) return;
    const g = 'group-' + Math.random().toString(36).slice(2, 7);
    selected().forEach((e) => { e.group = g; });
    focusGroup = null;
    commit();
    renderAll();
  }

  function ungroupSel() {
    selected().forEach((e) => { delete e.group; });
    focusGroup = null;
    commit();
    renderAll();
  }

  // ---------------------------------------------------------------- colours
  function paintColors(p, out) {
    if (!p || p === 'none') return;
    if (typeof p === 'string') out.add(R.normColor(p));
    else if (p.stops) p.stops.forEach((s) => out.add(R.normColor(s.color)));
  }

  function docColors() {
    const out = new Set();
    paintColors(doc.background, out);
    for (const el of doc.elements) {
      paintColors(el.fill, out);
      if (el.strokeWidth > 0) paintColors(el.stroke, out);
      if (el.type === 'vector') {
        const src = R.vectorSource(el);
        if (/currentColor/i.test(src)) out.add(R.normColor(el.color || '#000000'));
        for (const c of R.vectorColors(el)) if (c !== 'currentcolor') out.add(R.normColor((el.colorMap || {})[c] || c));
      }
    }
    return [...out].filter((c) => /^#[0-9a-f]{6}$/.test(c));
  }

  function replaceColorEverywhere(from, to) {
    const swapPaint = (p) => {
      if (typeof p === 'string') return R.normColor(p) === from ? to : p;
      if (p && p.stops) p.stops.forEach((s) => { if (R.normColor(s.color) === from) s.color = to; });
      return p;
    };
    doc.background = swapPaint(doc.background);
    for (const el of doc.elements) {
      if (el.fill) el.fill = swapPaint(el.fill);
      if (el.stroke) el.stroke = swapPaint(el.stroke);
      if (el.type === 'vector') {
        if (el.color && R.normColor(el.color) === from) el.color = to;
        for (const c of R.vectorColors(el)) {
          const cur = R.normColor((el.colorMap || {})[c] || c);
          if (cur === from) { el.colorMap = el.colorMap || {}; el.colorMap[c] = to; }
        }
      }
    }
  }

  // ---------------------------------------------------------------- layers panel
  const KIND = { text: 'T', rect: '▭', ellipse: '◯', image: '▣', vector: '✦' };
  let dragLayer = null;

  function renderLayers() {
    const box = $('#layers');
    box.innerHTML = '';
    const list = [...doc.elements].reverse();
    let prevGroup = null;
    for (const el of list) {
      if (el.group && el.group !== prevGroup) {
        const g = el.group;
        box.append(h('div', {
          class: 'layer-group', title: 'Select the whole group',
          onclick: (e) => {
            const ids = doc.elements.filter((x) => x.group === g).map((x) => x.id);
            sel = e.shiftKey ? [...new Set([...sel, ...ids])] : ids;
            focusGroup = null;
            renderLayers(); renderProps(); drawOverlay();
          },
        }, '▾ ' + g.replace(/[-_]/g, ' ')));
      }
      prevGroup = el.group || null;
      const row = h('div', {
        class: 'layer' + (sel.includes(el.id) ? ' sel' : '') + (el.hidden ? ' hidden' : '') + (el.group ? ' in-group' : ''),
        draggable: 'true',
        onclick: (e) => {
          if (e.target.closest('.lbtn')) return;
          if (e.shiftKey) sel = sel.includes(el.id) ? sel.filter((i) => i !== el.id) : [...sel, el.id];
          else sel = [el.id];
          if (el.group) focusGroup = el.group;
          renderLayers(); renderProps(); drawOverlay();
        },
        ondragstart: (e) => { dragLayer = el.id; e.dataTransfer.effectAllowed = 'move'; },
        ondragover: (e) => { e.preventDefault(); },
        ondrop: (e) => {
          e.preventDefault();
          if (!dragLayer || dragLayer === el.id) return;
          const moving = byId(dragLayer);
          doc.elements = doc.elements.filter((x) => x.id !== dragLayer);
          const idx = doc.elements.findIndex((x) => x.id === el.id);
          const r = e.currentTarget.getBoundingClientRect();
          const above = e.clientY < r.top + r.height / 2; // above in the list = in front
          doc.elements.splice(above ? idx + 1 : idx, 0, moving);
          dragLayer = null;
          commit();
          renderAll();
        },
      },
      h('span', { class: 'kind' }, KIND[el.type] || '?'),
      h('span', { class: 'lname', title: el.name }, el.name || el.type),
      h('button', {
        class: 'lbtn' + (el.hidden ? ' active' : ''), title: el.hidden ? 'Show' : 'Hide',
        onclick: () => { el.hidden = !el.hidden; commit(); renderAll(); },
      }, el.hidden ? '◌' : '👁'),
      h('button', {
        class: 'lbtn' + (el.locked ? ' active' : ''), title: el.locked ? 'Unlock' : 'Lock',
        onclick: () => { el.locked = !el.locked; commit(); renderAll(); },
      }, el.locked ? '🔒' : '🔓'));
      box.append(row);
    }
  }

  // ---------------------------------------------------------------- properties panel
  // Each control edits every selected element. 'input' re-renders live, 'change' records history.
  function live() { renderCanvas(); }
  function done() { commit(); renderLayers(); }

  function setAll(key, value) { selected().forEach((el) => { el[key] = value; }); }

  function sec(title, ...kids) {
    return h('div', { class: 'sec' }, title ? h('h4', {}, title) : null, ...kids);
  }

  function row(label, ...kids) { return h('div', { class: 'row' }, h('label', {}, label), ...kids); }

  function numInput(get, set, opts = {}) {
    return h('input', {
      type: 'number', step: opts.step || 1, min: opts.min, max: opts.max, value: round(get(), 2),
      oninput: (e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) { set(v); live(); } },
      onchange: () => { done(); drawOverlay(); },
    });
  }

  function rangeRow(label, get, set, opts) {
    const val = h('span', { class: 'val' }, fmtVal(get(), opts));
    const input = h('input', {
      type: 'range', min: opts.min, max: opts.max, step: opts.step, value: get(),
      oninput: (e) => { const v = parseFloat(e.target.value); set(v); val.textContent = fmtVal(v, opts); live(); },
      onchange: done,
    });
    return row(label, input, val);
  }
  function fmtVal(v, o) { return o.fmt ? o.fmt(v) : round(v, 2); }

  function textRow(label, get, set) {
    return row(label, h('input', {
      type: 'text', value: get() || '',
      oninput: (e) => { set(e.target.value); live(); },
      onchange: done,
    }));
  }

  function selectRow(label, options, get, set) {
    const s = h('select', {
      onchange: (e) => { set(e.target.value); live(); done(); renderProps(); },
    }, options.map(([v, t]) => h('option', { value: v, selected: String(get()) === String(v) }, t)));
    return row(label, s);
  }

  function checkRow(label, get, set) {
    return row(label, h('input', {
      type: 'checkbox', checked: !!get(),
      onchange: (e) => { set(e.target.checked); live(); done(); },
    }));
  }

  function colorControl(get, set) {
    const val = get() && /^#[0-9a-f]{6}$/i.test(get()) ? get() : '#000000';
    const text = h('input', {
      type: 'text', value: get() || '',
      onchange: (e) => {
        let v = e.target.value.trim();
        if (/^[0-9a-f]{6}$/i.test(v)) v = '#' + v;
        if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) { set(R.normColor(v)); picker.value = R.normColor(v); live(); done(); }
      },
    });
    const picker = h('input', {
      type: 'color', value: val,
      oninput: (e) => { set(e.target.value); text.value = e.target.value; live(); },
      onchange: done,
    });
    return h('div', { class: 'color' }, picker, text);
  }

  function swatches(onPick) {
    const cols = docColors().slice(0, 28);
    return h('div', { class: 'swatches' }, cols.map((c) => h('button', {
      title: c, style: `background:${c}`, onclick: () => { onPick(c); live(); done(); renderProps(); },
    })));
  }

  function colorRow(label, get, set) {
    return [row(label, colorControl(get, set)), swatches(set)];
  }

  // Paint = 'none' | '#rrggbb' | { type: 'linear', angle, stops: [{ offset, color, opacity }] }
  function paintEditor(label, get, set, allowNone = true) {
    const p = get();
    const mode = !p || p === 'none' ? 'none' : typeof p === 'string' ? 'solid' : 'gradient';
    const wrap = h('div', {});
    const modes = [['solid', 'Solid'], ['gradient', 'Gradient']];
    if (allowNone) modes.unshift(['none', 'None']);
    wrap.append(row(label, h('div', { class: 'btns' }, modes.map(([m, t]) => h('button', {
      class: m === mode ? 'on' : '',
      onclick: () => {
        const cur = get();
        const first = typeof cur === 'string' && cur !== 'none' ? cur : cur && cur.stops ? cur.stops[0].color : '#0b4331';
        if (m === 'none') set('none');
        if (m === 'solid') set(first);
        if (m === 'gradient' && mode !== 'gradient') {
          set({ type: 'linear', angle: 90, stops: [{ offset: 0, color: first, opacity: 1 }, { offset: 1, color: '#f4bf5e', opacity: 1 }] });
        }
        live(); done(); renderProps();
      },
    }, t)))));
    if (mode === 'solid') wrap.append(...colorRow('Colour', get, set));
    if (mode === 'gradient') {
      const g = p;
      wrap.append(row('Angle', numInput(() => g.angle || 0, (v) => { g.angle = v; set(g); }, { step: 15 }),
        h('button', { title: 'Reverse', onclick: () => { g.stops = g.stops.map((s) => Object.assign({}, s, { offset: 1 - s.offset })).reverse(); set(g); live(); done(); renderProps(); } }, '⇄')));
      wrap.append(h('div', { class: 'hint', style: 'margin:0 0 4px' }, 'Stops: colour · position % · opacity %'));
      g.stops.forEach((s, i) => {
        wrap.append(h('div', { class: 'stop' },
          colorControl(() => s.color, (v) => { s.color = v; set(g); }),
          numInput(() => s.offset * 100, (v) => { s.offset = Math.max(0, Math.min(1, v / 100)); set(g); }, { min: 0, max: 100 }),
          numInput(() => (s.opacity == null ? 1 : s.opacity) * 100, (v) => { s.opacity = Math.max(0, Math.min(1, v / 100)); set(g); }, { min: 0, max: 100 }),
          h('button', { title: 'Remove stop', disabled: g.stops.length <= 2, onclick: () => { g.stops.splice(i, 1); set(g); live(); done(); renderProps(); } }, '✕')));
      });
      wrap.append(h('div', { class: 'btns' }, h('button', {
        onclick: () => {
          const last = g.stops[g.stops.length - 1];
          g.stops.push({ offset: 1, color: last.color, opacity: last.opacity == null ? 1 : last.opacity });
          g.stops.sort((a, b) => a.offset - b.offset);
          set(g); live(); done(); renderProps();
        },
      }, '+ Add stop')));
    }
    return wrap;
  }

  function shadowSection(el) {
    const s = el.shadow || null;
    const on = !!(s && s.enabled !== false);
    const kids = [checkRow('Enabled', () => on, (v) => {
      el.shadow = Object.assign({ blur: 8, y: 3, x: 0, color: '#000000', opacity: 0.3 }, el.shadow || {}, { enabled: v });
      renderProps();
    })];
    if (on) {
      kids.push(rangeRow('Blur', () => s.blur || 0, (v) => { s.blur = v; }, { min: 0, max: 40, step: 0.5 }));
      kids.push(rangeRow('Offset X', () => s.x || 0, (v) => { s.x = v; }, { min: -30, max: 30, step: 0.5 }));
      kids.push(rangeRow('Offset Y', () => s.y || 0, (v) => { s.y = v; }, { min: -30, max: 30, step: 0.5 }));
      kids.push(...colorRow('Colour', () => s.color, (v) => { s.color = v; }));
      kids.push(rangeRow('Opacity', () => s.opacity == null ? 0.3 : s.opacity, (v) => { s.opacity = v; }, { min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' }));
    }
    return sec('Shadow', ...kids);
  }

  function arrangeSection(multi) {
    return sec(multi ? 'Arrange selection' : 'Arrange',
      h('div', { class: 'btns', style: 'margin-bottom:6px' },
        h('button', { title: 'Align left', onclick: () => align('left') }, '⇤'),
        h('button', { title: 'Align centre', onclick: () => align('hcenter') }, '↔'),
        h('button', { title: 'Align right', onclick: () => align('right') }, '⇥'),
        h('button', { title: 'Align top', onclick: () => align('top') }, '⤒'),
        h('button', { title: 'Align middle', onclick: () => align('vcenter') }, '↕'),
        h('button', { title: 'Align bottom', onclick: () => align('bottom') }, '⤓')),
      multi ? h('div', { class: 'btns', style: 'margin-bottom:6px' },
        h('button', { onclick: () => distribute('x') }, 'Distribute ↔'),
        h('button', { onclick: () => distribute('y') }, 'Distribute ↕')) : null,
      h('div', { class: 'btns', style: 'margin-bottom:6px' },
        h('button', { title: 'Bring to front (Ctrl+])', onclick: () => reorder('front') }, 'To front'),
        h('button', { title: 'Bring forward (])', onclick: () => reorder('forward') }, 'Forward'),
        h('button', { title: 'Send backward ([)', onclick: () => reorder('backward') }, 'Backward'),
        h('button', { title: 'Send to back (Ctrl+[)', onclick: () => reorder('back') }, 'To back')),
      h('div', { class: 'btns' },
        h('button', { title: 'Duplicate (Ctrl+D)', onclick: duplicateSel }, 'Duplicate'),
        multi ? h('button', { title: 'Group (Ctrl+G)', onclick: groupSel }, 'Group') : null,
        selected().some((e) => e.group) ? h('button', { title: 'Ungroup (Ctrl+Shift+G)', onclick: ungroupSel }, 'Ungroup') : null,
        h('button', { class: 'danger', title: 'Delete (Del)', onclick: deleteSel }, 'Delete')));
  }

  function renderProps() {
    const box = $('#props');
    box.innerHTML = '';
    const els = selected();
    if (!els.length) { box.append(...pageProps()); return; }
    if (els.length > 1) {
      box.append(sec(`${els.length} elements selected`,
        h('div', { class: 'hint' }, 'Drag to move together. Corner handles scale everything. Double-click an element to edit it on its own.')));
      box.append(arrangeSection(true));
      box.append(sec('Appearance', rangeRow('Opacity', () => els[0].opacity == null ? 1 : els[0].opacity, (v) => setAll('opacity', v), { min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' })));
      return;
    }
    const el = els[0];
    const set = (k) => (v) => { el[k] = v; };
    const get = (k) => () => el[k];

    box.append(sec(null,
      textRow('Name', get('name'), set('name')),
      el.locked ? h('div', { class: 'hint' }, '🔒 Locked: it can\'t be clicked on the canvas. Unlock it in the Layers panel to move it.') : null));

    if (el.type === 'text') {
      const ta = h('textarea', {
        class: 'txt', oninput: (e) => { el.text = e.target.value; live(); drawOverlay(); }, onchange: done,
      });
      ta.value = el.text;
      const fams = fontList();
      if (!fams.includes(el.font)) fams.unshift(el.font);
      box.append(sec('Text', ta,
        selectRow('Font', fams.map((f) => [f, f]), get('font'), (v) => {
          el.font = v;
          const ws = weightsFor(v);
          if (!ws.includes(Number(el.weight))) el.weight = ws.reduce((a, b) => (Math.abs(b - el.weight) < Math.abs(a - el.weight) ? b : a));
        }),
        selectRow('Weight', weightsFor(el.font).map((w) => [w, { 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' }[w] || w]), get('weight'), (v) => { el.weight = Number(v); }),
        row('Size', numInput(get('size'), set('size'), { step: 0.5, min: 1 }),
          h('button', { class: el.italic ? 'on' : '', title: 'Italic', onclick: () => { el.italic = !el.italic; live(); done(); renderProps(); } }, 'I'),
          h('button', { class: el.uppercase ? 'on' : '', title: 'All caps', onclick: () => { el.uppercase = !el.uppercase; live(); done(); renderProps(); } }, 'AA')),
        row('Align', h('div', { class: 'btns' }, ['left', 'center', 'right'].map((a) => h('button', {
          class: el.align === a ? 'on' : '', onclick: () => { el.align = a; live(); done(); renderProps(); },
        }, { left: 'Left', center: 'Centre', right: 'Right' }[a])))),
        rangeRow('Spacing', () => el.letterSpacing || 0, set('letterSpacing'), { min: -0.15, max: 0.5, step: 0.005, fmt: (v) => Math.round(v * 1000) }),
        rangeRow('Line height', get('lineHeight'), set('lineHeight'), { min: 0.7, max: 2.5, step: 0.01 }),
        checkRow('Fit to box', get('fitWidth'), set('fitWidth')),
        h('div', { class: 'hint' }, 'Fit to box squeezes or stretches each line to the box width. Double-click text on the canvas to type in place.')));
      box.append(sec('Fill', paintEditor('Type', get('fill'), set('fill'), false)));
      box.append(sec('Outline',
        rangeRow('Width', () => el.outlineWidth || 0, set('outlineWidth'), { min: 0, max: 8, step: 0.1 }),
        ...colorRow('Colour', () => el.outlineColor || '#000000', set('outlineColor'))));
    }

    if (el.type === 'rect' || el.type === 'ellipse') {
      box.append(sec('Fill', paintEditor('Type', get('fill'), set('fill'))));
      if (el.type === 'rect') box.append(sec('Corners', rangeRow('Radius', () => el.radius || 0, set('radius'), { min: 0, max: Math.round(Math.min(el.w, el.h) / 2), step: 0.5 })));
      box.append(sec('Border',
        rangeRow('Width', () => el.strokeWidth || 0, set('strokeWidth'), { min: 0, max: 12, step: 0.1 }),
        ...colorRow('Colour', () => (typeof el.stroke === 'string' && el.stroke !== 'none' ? el.stroke : '#000000'), set('stroke'))));
    }

    if (el.type === 'image') {
      const prev = h('img', { class: 'preview-thumb', src: editorResolve(el.src) || '' });
      box.append(sec('Image', prev,
        h('div', { class: 'btns', style: 'margin-bottom:8px' },
          h('button', { class: 'primary', onclick: () => pickImage(el.id) }, 'Replace image…'),
          h('button', { onclick: () => { el.zoom = 1; el.panX = 0; el.panY = 0; live(); done(); renderProps(); } }, 'Reset crop')),
        selectRow('Fit', [['cover', 'Fill frame (crop)'], ['contain', 'Fit inside'], ['fill', 'Stretch']], get('fit'), set('fit')),
        rangeRow('Zoom', () => el.zoom || 1, set('zoom'), { min: 0.2, max: 4, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' }),
        rangeRow('Move ↔', () => el.panX || 0, set('panX'), { min: -100, max: 100, step: 0.5 }),
        rangeRow('Move ↕', () => el.panY || 0, set('panY'), { min: -100, max: 100, step: 0.5 }),
        rangeRow('Corners', () => el.radius || 0, set('radius'), { min: 0, max: Math.round(Math.min(el.w, el.h) / 2), step: 0.5 })));
      box.append(sec('Fade edges',
        rangeRow('Top', () => el.fadeTop || 0, set('fadeTop'), { min: 0, max: 100, step: 1, fmt: (v) => v + '%' }),
        rangeRow('Bottom', () => el.fadeBottom || 0, set('fadeBottom'), { min: 0, max: 100, step: 1, fmt: (v) => v + '%' }),
        rangeRow('Left', () => el.fadeLeft || 0, set('fadeLeft'), { min: 0, max: 100, step: 1, fmt: (v) => v + '%' }),
        rangeRow('Right', () => el.fadeRight || 0, set('fadeRight'), { min: 0, max: 100, step: 1, fmt: (v) => v + '%' })));
    }

    if (el.type === 'vector') {
      const src = R.vectorSource(el);
      const isIcon = (el.svg || '').startsWith('icon:');
      const usesCurrent = /currentColor/i.test(src);
      const kids = [h('div', { class: 'btns', style: 'margin-bottom:8px' },
        h('button', { class: 'primary', onclick: () => openIconPicker(el.id) }, 'Replace icon…'),
        h('button', { onclick: () => { replaceTarget = el.id; $('#fileSvg').click(); } }, 'Use SVG file…'),
        h('button', { onclick: () => openCodeEditor(el) }, 'Edit SVG code…'))];
      if (usesCurrent) kids.push(...colorRow('Colour', () => el.color || '#000000', set('color')));
      if (isIcon) kids.push(rangeRow('Line width', () => el.strokeWidth == null ? 2 : el.strokeWidth, set('strokeWidth'), { min: 0.25, max: 4, step: 0.05 }));
      kids.push(checkRow('Keep shape', () => el.keepAspect !== false, (v) => { el.keepAspect = v; }));
      box.append(sec(isIcon ? 'Icon' : 'Vector artwork', ...kids));
      const cols = R.vectorColors(el).filter((c) => c !== 'currentcolor');
      if (cols.length) {
        el.colorMap = el.colorMap || {};
        box.append(sec('Colours in this artwork',
          h('div', { class: 'vec-colors' }, cols.map((c) => row(
            h('span', { class: 'orig', title: 'Original ' + c, style: `background:${c}` }),
            colorControl(() => el.colorMap[c] || c, (v) => { el.colorMap[c] = v; }),
          ))),
          h('div', { class: 'btns', style: 'margin-top:6px' },
            h('button', { onclick: () => { el.colorMap = {}; live(); done(); renderProps(); } }, 'Reset colours'),
            h('button', {
              title: 'Paint every colour in this artwork with one colour',
              onclick: () => { const v = prompt('One colour for the whole artwork (hex):', '#0b4331'); if (v && /^#?[0-9a-f]{6}$/i.test(v)) { const c2 = v.startsWith('#') ? v : '#' + v; cols.forEach((c) => { el.colorMap[c] = c2; }); live(); done(); renderProps(); } },
            }, 'Make one colour'))));
      }
    }

    // Common geometry
    const geo = [h('div', { class: 'grid2' },
      h('label', {}, 'X', numInput(get('x'), set('x'), { step: 0.5 })),
      h('label', {}, 'Y', numInput(get('y'), set('y'), { step: 0.5 })),
      h('label', {}, 'W', numInput(get('w'), set('w'), { step: 0.5, min: 1 })),
      el.type === 'text'
        ? h('label', {}, 'H', h('input', { type: 'number', disabled: true, value: round(R.textHeight(el), 1) }))
        : h('label', {}, 'H', numInput(get('h'), set('h'), { step: 0.5, min: 1 })),
      h('label', {}, '⟳', numInput(() => el.rotation || 0, set('rotation'), { step: 1 })),
      h('label', {}, '%', numInput(() => Math.round((el.opacity == null ? 1 : el.opacity) * 100), (v) => { el.opacity = Math.max(0, Math.min(1, v / 100)); }, { min: 0, max: 100 })))];
    if (el.type === 'image' || el.type === 'vector') {
      geo.push(h('div', { class: 'btns' },
        h('button', { class: el.flipX ? 'on' : '', onclick: () => { el.flipX = !el.flipX; live(); done(); renderProps(); } }, 'Flip ↔'),
        h('button', { class: el.flipY ? 'on' : '', onclick: () => { el.flipY = !el.flipY; live(); done(); renderProps(); } }, 'Flip ↕')));
    }
    box.append(sec('Position & size (points)', ...geo));
    box.append(shadowSection(el));
    box.append(arrangeSection(false));
  }

  function pageProps() {
    const out = [];
    out.push(sec('Page',
      h('div', { class: 'hint' }, `A4 · ${round(doc.width, 1)} × ${round(doc.height, 1)} pt`),
      paintEditor('Background', () => doc.background, (v) => { doc.background = v; }, false)));
    const cols = docColors();
    out.push(sec('Colours used in this flyer',
      h('div', { class: 'hint', style: 'margin-bottom:8px' }, 'Change a colour here to swap it everywhere: text, shapes, gradients and icons.'),
      h('div', { class: 'vec-colors' }, cols.map((c) => {
        let cur = c;
        return row(h('span', { class: 'orig', style: `background:${c}` }), colorControl(() => c, (v) => { replaceColorEverywhere(cur, v); cur = v; }));
      }))));
    out.push(sec('How to edit',
      h('div', { class: 'hint', html: [
        '<b>Click</b> selects a whole block (a card, the header…). <b>Double-click</b> picks one element inside it; on text it lets you type in place, on an image it opens Replace, on an icon it opens the icon picker.',
        '<b>Drag</b> to move, use the handles to resize, and the round top handle to rotate. Hold <kbd>Shift</kbd> to ignore the aspect ratio, <kbd>Alt</kbd> to resize from the centre or move without snapping.',
        'Everything is listed in <b>Layers</b>. Drag rows to restack, 👁 hides, 🔒 locks.',
        '<kbd>Ctrl Z</kbd> undo · <kbd>Ctrl D</kbd> duplicate · <kbd>Ctrl C</kbd>/<kbd>V</kbd> copy, paste · <kbd>Del</kbd> delete · arrow keys nudge (<kbd>Shift</kbd> = 10) · <kbd>Ctrl G</kbd> group · <kbd>[</kbd> <kbd>]</kbd> restack · <kbd>Esc</kbd> deselect',
        'Your work autosaves in this browser. Use <b>Export ▸ Save project</b> to keep a file or move it to another computer.',
      ].map((s) => `<p style="margin:0 0 6px">${s}</p>`).join('') })));
    return out;
  }

  // ---------------------------------------------------------------- image replacement
  function pickImage(targetId) {
    replaceTarget = targetId || null;
    const inp = $('#fileImage');
    inp.value = '';
    inp.click();
  }

  $('#fileImage').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const data = await readImageFile(file);
    const key = 'u' + Date.now().toString(36);
    doc.assets[key] = data;
    const target = replaceTarget && byId(replaceTarget);
    if (target && target.type === 'image') {
      target.src = 'upload:' + key;
      target.zoom = 1; target.panX = 0; target.panY = 0;
      commit();
      renderAll();
    } else {
      const im = new Image();
      im.onload = () => addImage(key, im.naturalWidth, im.naturalHeight);
      im.src = data;
    }
    replaceTarget = null;
    persist();
  });

  $('#fileSvg').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    if (!/<svg[\s>]/i.test(text)) { toast('That file does not look like an SVG.'); return; }
    const target = replaceTarget && byId(replaceTarget);
    if (target && target.type === 'vector') {
      target.svg = text;
      target.colorMap = {};
      target.h = round(target.w / vbAspect(text));
      commit();
      renderAll();
    } else {
      const name = file.name.replace(/\.svg$/i, '');
      const asp = vbAspect(text);
      const el = Object.assign(base('vector', name, 160, round(160 / asp)), { svg: text, color: '#0b4331', strokeWidth: 2 });
      insertNew(el);
    }
    replaceTarget = null;
  });

  // ---------------------------------------------------------------- SVG code editor
  let codeTarget = null;
  function openCodeEditor(el) {
    codeTarget = el.id;
    $('#codeText').value = R.vectorSource(el);
    $('#codeModal').hidden = false;
  }
  $('#codeApply').addEventListener('click', () => {
    const el = byId(codeTarget);
    const v = $('#codeText').value.trim();
    if (el && /<svg[\s>]/i.test(v)) {
      el.svg = v;
      el.colorMap = {};
      commit();
      renderAll();
    }
    $('#codeModal').hidden = true;
  });

  // ---------------------------------------------------------------- icon picker
  let iconTab = 'all', iconLimit = 240;
  const brandItems = () => Object.keys(window.BZ_ASSETS.vectors).map((k) => ({ key: 'asset:' + k, label: k, tags: [], src: window.BZ_ASSETS.vectors[k], set: 'brand' }));
  const iconSvg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const customItems = () => Object.keys(window.BZ_ICONS.custom).map((k) => ({ key: 'icon:custom/' + k, label: k, tags: [], src: iconSvg(window.BZ_ICONS.custom[k]), set: 'custom' }));
  let lucideCache = null;
  const lucideItems = () => lucideCache || (lucideCache = Object.keys(window.BZ_ICONS.lucide).map((k) => ({ key: 'icon:lucide/' + k, label: k, tags: window.BZ_ICONS.tags[k] || [], src: null, inner: window.BZ_ICONS.lucide[k], set: 'lucide' })));

  function openIconPicker(targetId) {
    replaceTarget = targetId || null;
    $('#iconModalTitle').textContent = targetId ? 'Replace icon' : 'Add an icon';
    $('#iconModal').hidden = false;
    iconLimit = 240;
    renderIconGrid();
    $('#iconSearch').focus();
  }

  function renderIconGrid() {
    const q = $('#iconSearch').value.trim().toLowerCase();
    let items = [];
    if (iconTab === 'all' || iconTab === 'brand') items.push(...brandItems());
    if (iconTab === 'all' || iconTab === 'custom') items.push(...customItems());
    if (iconTab === 'all' || iconTab === 'lucide') items.push(...lucideItems());
    if (q) items = items.filter((it) => it.label.includes(q) || it.tags.some((t) => t.includes(q)));
    const grid = $('#iconGrid');
    grid.innerHTML = items.slice(0, iconLimit).map((it) =>
      `<button data-key="${it.key}" title="${it.label}">${it.src || iconSvg(it.inner)}<span>${it.label}</span></button>`).join('');
    $('#iconMore').hidden = items.length <= iconLimit;
    if (!items.length) grid.innerHTML = '<div class="hint">No icons match. Try another word, or import your own SVG with ＋ SVG file.</div>';
  }

  $('#iconSearch').addEventListener('input', () => { iconLimit = 240; renderIconGrid(); });
  $('#iconMore').addEventListener('click', () => { iconLimit += 480; renderIconGrid(); });
  document.querySelectorAll('.icon-tabs button').forEach((b) => b.addEventListener('click', () => {
    iconTab = b.dataset.tab;
    document.querySelectorAll('.icon-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    iconLimit = 240;
    renderIconGrid();
  }));
  $('#iconGrid').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-key]');
    if (!b) return;
    const key = b.dataset.key;
    const target = replaceTarget && byId(replaceTarget);
    $('#iconModal').hidden = true;
    if (target && target.type === 'vector') {
      const wasIcon = (target.svg || '').startsWith('icon:');
      target.svg = key;
      target.colorMap = {};
      if (!key.startsWith('icon:') || !wasIcon) target.h = round(target.w / vbAspect(R.vectorSource(target)));
      commit();
      renderAll();
    } else {
      addVector(key, b.title);
    }
    replaceTarget = null;
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { b.closest('.modal').hidden = true; }));
  // Close a modal by clicking its backdrop, ignoring the tail of the double-click that opened it.
  let modalOpenedAt = 0;
  new MutationObserver(() => { modalOpenedAt = performance.now(); })
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => {
    if (e.target === m && performance.now() - modalOpenedAt > 400) m.hidden = true;
  }));

  // ---------------------------------------------------------------- export
  function buildExportSvg() {
    return R.exportSvg(doc, { resolveImage: exportResolve, imageSize });
  }

  async function exportRaster(scale, mime, name) {
    toast('Rendering…', 10000);
    try {
      const svgText = buildExportSvg();
      const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not render the flyer.')); img.src = url; });
      if (img.decode) await img.decode().catch(() => {});
      const c = document.createElement('canvas');
      c.width = Math.round(doc.width * scale);
      c.height = Math.round(doc.height * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise((res) => c.toBlob(res, mime, 0.92));
      if (!blob) throw new Error('Your browser blocked the image export. Try the PDF or SVG export instead.');
      download(blob, name);
      toast(`Saved ${name} (${c.width} × ${c.height} px)`);
    } catch (err) {
      toast(err.message || String(err), 5000);
    }
  }

  function exportPdf() {
    const area = $('#printArea');
    area.innerHTML = buildExportSvg().replace(/^<\?xml[^>]*>\s*/, '');
    const cleanup = () => { area.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    toast('In the print dialog choose "Save as PDF", paper A4, margins None.', 6000);
    setTimeout(() => window.print(), 300);
  }

  function saveProject() {
    const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
    download(blob, 'baazar-flyer-project.json');
  }

  $('#fileJson').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!d || !Array.isArray(d.elements)) throw new Error('bad');
      doc = Object.assign({ fonts: [], assets: {}, width: 595.276, height: 841.89, background: '#ffffff' }, d);
      imgCache.clear();
      sel = [];
      injectFonts();
      resetHistory();
      persist();
      setZoom(zoom);
      renderAll();
      toast('Project opened.');
    } catch (err) {
      toast('That file is not a Baazar flyer project.');
    }
  });

  $('#fileFont').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const family = file.name.replace(/\.(woff2?|ttf|otf)$/i, '').replace(/[-_]+/g, ' ').trim();
    const fr = new FileReader();
    fr.onload = () => {
      doc.fonts = (doc.fonts || []).filter((f) => f.family !== family);
      doc.fonts.push({ family, src: fr.result });
      injectFonts();
      persist();
      renderAll();
      toast(`Font "${family}" added. Pick it from the Font list on any text.`, 4000);
    };
    fr.readAsDataURL(file);
  });

  $('#exportBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#exportMenu').hidden = !$('#exportMenu').hidden;
  });
  document.addEventListener('click', () => { $('#exportMenu').hidden = true; });
  $('#exportMenu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-export]');
    if (!b) return;
    $('#exportMenu').hidden = true;
    const k = b.dataset.export;
    if (k === 'png-print') exportRaster(300 / 72, 'image/png', 'baazar-flyer.png');
    if (k === 'png-screen') exportRaster(1080 / doc.width, 'image/png', 'baazar-flyer-1080.png');
    if (k === 'jpg-print') exportRaster(300 / 72, 'image/jpeg', 'baazar-flyer.jpg');
    if (k === 'pdf') exportPdf();
    if (k === 'svg') download(new Blob([buildExportSvg()], { type: 'image/svg+xml' }), 'baazar-flyer.svg');
    if (k === 'save') saveProject();
    if (k === 'open') $('#fileJson').click();
    if (k === 'font') $('#fileFont').click();
    if (k === 'reset' && confirm('Reset to the original Baazar template? Your current changes will be lost (save a project file first if you want to keep them).')) {
      doc = freshDoc();
      imgCache.clear();
      sel = [];
      injectFonts();
      resetHistory();
      persist();
      renderAll();
    }
  });

  // ---------------------------------------------------------------- toolbar & keyboard
  document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.add;
    if (k === 'text') addText();
    if (k === 'rect' || k === 'ellipse') addRect(k);
    if (k === 'image') pickImage(null);
    if (k === 'icon') openIconPicker(null);
    if (k === 'svg') { replaceTarget = null; $('#fileSvg').click(); }
  }));
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);
  $('#zoomIn').addEventListener('click', () => setZoom(zoom * 1.2));
  $('#zoomOut').addEventListener('click', () => setZoom(zoom / 1.2));
  $('#zoomFit').addEventListener('click', zoomFit);
  $('#stage').addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });

  let nudgeTimer = null;
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
    if (!$('#iconModal').hidden || !$('#codeModal').hidden) {
      if (e.key === 'Escape') { $('#iconModal').hidden = true; $('#codeModal').hidden = true; }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (mod && k.toLowerCase() === 'c') { if (sel.length) clipboard = clone(doc.elements.filter((x) => sel.includes(x.id))); return; }
    if (mod && k.toLowerCase() === 'x') { if (sel.length) { clipboard = clone(doc.elements.filter((x) => sel.includes(x.id))); deleteSel(); } return; }
    if (mod && k.toLowerCase() === 'v') { if (clipboard) pasteElements(clipboard, 10); return; }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); sel = doc.elements.filter((x) => !x.locked && !x.hidden).map((x) => x.id); renderLayers(); renderProps(); drawOverlay(); return; }
    if (mod && k.toLowerCase() === 'g') { e.preventDefault(); e.shiftKey ? ungroupSel() : groupSel(); return; }
    if (k === ']') { e.preventDefault(); reorder(mod ? 'front' : 'forward'); return; }
    if (k === '[') { e.preventDefault(); reorder(mod ? 'back' : 'backward'); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSel(); return; }
    if (k === 'Escape') {
      if (focusGroup) { const g = focusGroup; focusGroup = null; sel = groupMembers(g); }
      else sel = [];
      renderLayers(); renderProps(); drawOverlay();
      return;
    }
    if (k === 'Enter' && sel.length === 1) {
      const el = byId(sel[0]);
      if (el.type === 'text') { e.preventDefault(); openInlineEditor(el); }
      return;
    }
    if (k.startsWith('Arrow') && sel.length) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      const dx = k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0;
      const dy = k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
      selected().filter((x) => !x.locked).forEach((x) => { x.x = round(x.x + dx); x.y = round(x.y + dy); });
      renderCanvas();
      clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(() => { commit(); renderProps(); }, 400);
      return;
    }
    if (mod) return;
    if (k === '+' || k === '=') setZoom(zoom * 1.2);
    else if (k === '-') setZoom(zoom / 1.2);
    else if (k === '0') zoomFit();
    else if (k === 't') addText();
    else if (k === 'r') addRect('rect');
    else if (k === 'e') addRect('ellipse');
    else if (k === 'i') openIconPicker(null);
  });

  window.addEventListener('resize', () => drawOverlay());

  // ---------------------------------------------------------------- start
  doc = loadDoc();
  injectFonts();
  setZoom(1);
  resetHistory();
  renderAll();
  requestAnimationFrame(zoomFit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => renderCanvas());

  // Exposed for debugging and automated checks.
  window.BZEditor = { get doc() { return doc; }, get sel() { return sel; }, renderAll, buildExportSvg };
})();
