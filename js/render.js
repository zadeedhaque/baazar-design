// Turns a flyer document into SVG markup. Shared by the editor canvas and all exports.
(function () {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = (v) => (Math.round(v * 1000) / 1000).toString();

  // ---------- vector sources ----------
  const parsedCache = new Map();

  function vectorSource(el) {
    const s = el.svg || '';
    if (s.startsWith('asset:')) return (window.BZ_ASSETS.vectors[s.slice(6)] || '');
    if (s.startsWith('icon:')) {
      const [set, name] = s.slice(5).split('/');
      const inner = set === 'custom' ? window.BZ_ICONS.custom[name] : window.BZ_ICONS.lucide[name];
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (inner || '') + '</svg>';
    }
    return s;
  }

  function parseSvg(src) {
    if (parsedCache.has(src)) return parsedCache.get(src);
    let out = { viewBox: '0 0 24 24', attrs: {}, inner: '' };
    try {
      const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
      const root = doc.documentElement;
      if (root && root.nodeName.toLowerCase() === 'svg') {
        let vb = root.getAttribute('viewBox');
        if (!vb) {
          const w = parseFloat(root.getAttribute('width')) || 24;
          const h = parseFloat(root.getAttribute('height')) || 24;
          vb = `0 0 ${w} ${h}`;
        }
        const attrs = {};
        for (const a of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule']) {
          if (root.hasAttribute(a)) attrs[a] = root.getAttribute(a);
        }
        // Strip scripts and event handlers from pasted or uploaded SVG.
        root.querySelectorAll('script, foreignObject').forEach((n) => n.remove());
        root.querySelectorAll('*').forEach((n) => {
          for (const a of [...n.attributes]) if (/^on/i.test(a.name)) n.removeAttribute(a.name);
        });
        const ser = new XMLSerializer();
        out = { viewBox: vb, attrs, inner: [...root.childNodes].map((n) => ser.serializeToString(n)).join('') };
      }
    } catch (e) { /* fall through with empty */ }
    parsedCache.set(src, out);
    return out;
  }

  const COLOR_ATTR = /(fill|stroke|stop-color|color)\s*=\s*"([^"]+)"/gi;
  const COLOR_CSS = /(fill|stroke|stop-color)\s*:\s*([^;"]+)/gi;

  function normColor(c) {
    c = c.trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(c)) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    return c;
  }

  // Unique colours used inside a vector, for per-colour editing.
  function vectorColors(el) {
    const p = parseSvg(vectorSource(el));
    const text = Object.entries(p.attrs).map(([k, v]) => `${k}="${v}"`).join(' ') + p.inner;
    const set = new Set();
    let m;
    COLOR_ATTR.lastIndex = 0;
    while ((m = COLOR_ATTR.exec(text))) set.add(normColor(m[2]));
    COLOR_CSS.lastIndex = 0;
    while ((m = COLOR_CSS.exec(text))) set.add(normColor(m[2]));
    for (const c of ['none', 'transparent', 'inherit']) set.delete(c);
    [...set].forEach((c) => { if (c.startsWith('url(')) set.delete(c); });
    return [...set];
  }

  function applyColorMap(markup, map) {
    if (!map) return markup;
    const keys = Object.keys(map);
    if (!keys.length) return markup;
    const swap = (c) => {
      const k = normColor(c);
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : c;
    };
    return markup
      .replace(COLOR_ATTR, (all, a, c) => `${a}="${swap(c)}"`)
      .replace(COLOR_CSS, (all, a, c) => `${a}:${swap(c)}`);
  }

  function prefixIds(markup, prefix) {
    return markup
      .replace(/\bid="([^"]+)"/g, (a, id) => `id="${prefix}${id}"`)
      .replace(/url\(\s*#([^)\s]+)\s*\)/g, (a, id) => `url(#${prefix}${id})`)
      .replace(/(xlink:href|href)="#([^"]+)"/g, (a, attr, id) => `${attr}="#${prefix}${id}"`);
  }

  // ---------- paints ----------
  function gradientDef(id, paint) {
    const a = ((paint.angle || 0) * Math.PI) / 180;
    const dx = Math.sin(a), dy = -Math.cos(a);
    const stops = (paint.stops || []).map((s) =>
      `<stop offset="${num(s.offset)}" stop-color="${esc(s.color)}" stop-opacity="${num(s.opacity == null ? 1 : s.opacity)}"/>`).join('');
    return `<linearGradient id="${id}" x1="${num(0.5 - dx / 2)}" y1="${num(0.5 - dy / 2)}" x2="${num(0.5 + dx / 2)}" y2="${num(0.5 + dy / 2)}">${stops}</linearGradient>`;
  }

  function paintAttr(paint, id, defs) {
    if (!paint || paint === 'none') return 'none';
    if (typeof paint === 'string') return esc(paint);
    if (paint.type === 'linear') {
      defs.push(gradientDef(id, paint));
      return `url(#${id})`;
    }
    return 'none';
  }

  // ---------- text ----------
  function textLines(el) {
    const t = el.uppercase ? String(el.text).toUpperCase() : String(el.text);
    return t.split('\n');
  }

  function textHeight(el) {
    return textLines(el).length * el.size * el.lineHeight;
  }

  function fontStack(font) {
    const generic = /^(Georgia|Times New Roman)$/.test(font) ? 'serif' : 'sans-serif';
    return `'${font}', ${generic}`;
  }

  // ---------- geometry ----------
  function bounds(el) {
    const h = el.type === 'text' ? textHeight(el) : el.h;
    return { x: el.x, y: el.y, w: el.w, h };
  }

  function transformAttr(el) {
    const b = bounds(el);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const parts = [];
    if (el.rotation) parts.push(`rotate(${num(el.rotation)} ${num(cx)} ${num(cy)})`);
    if (el.flipX || el.flipY) {
      parts.push(`translate(${num(cx)} ${num(cy)}) scale(${el.flipX ? -1 : 1} ${el.flipY ? -1 : 1}) translate(${num(-cx)} ${num(-cy)})`);
    }
    return parts.length ? ` transform="${parts.join(' ')}"` : '';
  }

  function shadowFilter(el, id, defs) {
    const s = el.shadow;
    if (!s || s.enabled === false) return '';
    defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${num(s.x || 0)}" dy="${num(s.y || 0)}" stdDeviation="${num((s.blur || 0) / 2)}" flood-color="${esc(s.color || '#000')}" flood-opacity="${num(s.opacity == null ? 0.3 : s.opacity)}"/></filter>`);
    return ` filter="url(#${id})"`;
  }

  // ---------- elements ----------
  function renderElement(el, ctx) {
    const { defs, pfx } = ctx;
    const id = pfx + el.id;
    const parts = [];
    if (el.type === 'rect' || el.type === 'ellipse') {
      const fill = paintAttr(el.fill, id + '-fill', defs);
      const stroke = paintAttr(el.stroke, id + '-stroke', defs);
      const sw = el.strokeWidth || 0;
      const common = `fill="${fill}" stroke="${sw > 0 ? stroke : 'none'}" stroke-width="${num(sw)}"`;
      if (el.type === 'rect') {
        const r = Math.min(el.radius || 0, el.w / 2, el.h / 2);
        parts.push(`<rect x="${num(el.x)}" y="${num(el.y)}" width="${num(el.w)}" height="${num(el.h)}" rx="${num(r)}" ${common}/>`);
      } else {
        parts.push(`<ellipse cx="${num(el.x + el.w / 2)}" cy="${num(el.y + el.h / 2)}" rx="${num(el.w / 2)}" ry="${num(el.h / 2)}" ${common}/>`);
      }
    } else if (el.type === 'text') {
      const fill = paintAttr(el.fill, id + '-fill', defs);
      const lines = textLines(el);
      const LH = el.size * el.lineHeight;
      const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
      const ax = el.align === 'center' ? el.x + el.w / 2 : el.align === 'right' ? el.x + el.w : el.x;
      const spans = lines.map((line, i) => {
        const y = el.y + i * LH + LH / 2 + el.size * 0.35;
        const fit = el.fitWidth && line.trim() ? ` textLength="${num(el.w)}" lengthAdjust="spacingAndGlyphs"` : '';
        const fx = el.fitWidth ? el.x : ax;
        return `<tspan x="${num(fx)}" y="${num(y)}"${fit}>${esc(line) || ' '}</tspan>`;
      }).join('');
      const stroke = el.outlineWidth > 0 ? ` stroke="${esc(el.outlineColor || '#000')}" stroke-width="${num(el.outlineWidth)}" paint-order="stroke" stroke-linejoin="round"` : '';
      parts.push(`<text xml:space="preserve" font-family="${esc(fontStack(el.font))}" font-size="${num(el.size)}" font-weight="${el.weight}" font-style="${el.italic ? 'italic' : 'normal'}" letter-spacing="${num((el.letterSpacing || 0) * el.size)}" text-anchor="${el.fitWidth ? 'start' : anchor}" fill="${fill}"${stroke}>${spans}</text>`);
    } else if (el.type === 'image') {
      const href = ctx.resolveImage(el.src);
      const dims = ctx.imageSize(el.src);
      const clipId = id + '-clip';
      defs.push(`<clipPath id="${clipId}"><rect x="${num(el.x)}" y="${num(el.y)}" width="${num(el.w)}" height="${num(el.h)}" rx="${num(Math.min(el.radius || 0, el.w / 2, el.h / 2))}"/></clipPath>`);
      let img;
      if (!href) {
        img = `<rect x="${num(el.x)}" y="${num(el.y)}" width="${num(el.w)}" height="${num(el.h)}" fill="#ddd"/>`;
      } else if (el.fit === 'fill' || !dims) {
        img = `<image href="${esc(href)}" x="${num(el.x)}" y="${num(el.y)}" width="${num(el.w)}" height="${num(el.h)}" preserveAspectRatio="${el.fit === 'fill' ? 'none' : el.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'}"/>`;
      } else {
        const base = el.fit === 'contain' ? Math.min(el.w / dims.w, el.h / dims.h) : Math.max(el.w / dims.w, el.h / dims.h);
        const s = base * (el.zoom || 1);
        const dw = dims.w * s, dh = dims.h * s;
        const dx = el.x + (el.w - dw) * (0.5 + (el.panX || 0) / 100);
        const dy = el.y + (el.h - dh) * (0.5 + (el.panY || 0) / 100);
        img = `<image href="${esc(href)}" x="${num(dx)}" y="${num(dy)}" width="${num(dw)}" height="${num(dh)}" preserveAspectRatio="none"/>`;
      }
      let inner = `<g clip-path="url(#${clipId})">${img}</g>`;
      const fades = [['fadeTop', 0, 1], ['fadeBottom', 0, -1], ['fadeLeft', 1, 0], ['fadeRight', -1, 0]];
      for (const [key, hx, vy] of fades) {
        const amt = el[key] || 0;
        if (amt <= 0) continue;
        const gid = `${id}-${key}`;
        const horiz = hx !== 0;
        const fwd = horiz ? hx > 0 : vy > 0;
        const x1 = horiz ? (fwd ? 0 : 1) : 0, x2 = horiz ? (fwd ? 1 : 0) : 0;
        const y1 = horiz ? 0 : (fwd ? 0 : 1), y2 = horiz ? 0 : (fwd ? 1 : 0);
        defs.push(`<linearGradient id="${gid}-g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="#000"/><stop offset="${num(Math.min(amt, 100) / 100)}" stop-color="#fff"/></linearGradient>`);
        defs.push(`<mask id="${gid}" maskUnits="userSpaceOnUse" x="${num(el.x)}" y="${num(el.y)}" width="${num(el.w)}" height="${num(el.h)}"><rect x="${num(el.x)}" y="${num(el.y)}" width="${num(el.w)}" height="${num(el.h)}" fill="url(#${gid}-g)"/></mask>`);
        inner = `<g mask="url(#${gid})">${inner}</g>`;
      }
      parts.push(inner);
    } else if (el.type === 'vector') {
      const p = parseSvg(vectorSource(el));
      const isIcon = (el.svg || '').startsWith('icon:');
      const attrs = Object.assign({}, p.attrs);
      if (isIcon) attrs['stroke-width'] = String(el.strokeWidth == null ? 2 : el.strokeWidth);
      const attrStr = applyColorMap(Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' '), el.colorMap);
      const inner = prefixIds(applyColorMap(p.inner, el.colorMap), id + '-');
      const par = el.keepAspect === false ? 'none' : 'xMidYMid meet';
      parts.push(`<svg x="${num(el.x)}" y="${num(el.y)}" width="${num(el.w)}" height="${num(el.h)}" viewBox="${esc(p.viewBox)}" preserveAspectRatio="${par}" overflow="visible" color="${esc(el.color || '#000')}" ${attrStr}>${inner}</svg>`);
    }
    if (ctx.editor && (el.type === 'text' || el.type === 'vector')) {
      // Invisible hit area so clicks between letters or inside an icon's gaps still select it.
      const b = bounds(el);
      parts.unshift(`<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" fill="#000" fill-opacity="0"/>`);
    }
    const filter = shadowFilter(el, id + '-shadow', defs);
    const op = el.opacity != null && el.opacity < 1 ? ` opacity="${num(el.opacity)}"` : '';
    const blend = el.blend && el.blend !== 'normal' ? ` style="mix-blend-mode:${esc(el.blend)}"` : '';
    const dataAttr = ctx.editor ? ` data-id="${esc(el.id)}"${el.locked ? ' class="locked"' : ''}` : '';
    return `<g${dataAttr}${transformAttr(el)}${op}${blend}${filter}>${parts.join('')}</g>`;
  }

  function fontFaceCss(families, uploaded) {
    const css = [];
    for (const f of window.BZ_FONTS) {
      if (families && !families.has(f.family)) continue;
      css.push(`@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:${f.style};src:url(${f.src}) format('woff2');}`);
    }
    for (const f of uploaded || []) {
      if (families && !families.has(f.family)) continue;
      css.push(`@font-face{font-family:'${f.family}';src:url(${f.src});}`);
    }
    return css.join('\n');
  }

  // Render the page contents. opts: { editor, idPrefix, resolveImage, imageSize }
  function renderDoc(doc, opts) {
    const defs = [];
    const ctx = Object.assign({ defs, pfx: opts.idPrefix || '' }, opts);
    const body = [`<rect x="0" y="0" width="${num(doc.width)}" height="${num(doc.height)}" fill="${paintAttr(doc.background, ctx.pfx + 'page-bg', defs)}"${ctx.editor ? ' data-page="1"' : ''}/>`];
    for (const el of doc.elements) {
      if (el.hidden) continue;
      body.push(renderElement(el, ctx));
    }
    return { defs: defs.join(''), body: body.join('') };
  }

  // Standalone SVG file with fonts and images embedded.
  function exportSvg(doc, opts) {
    const families = new Set(doc.elements.filter((e) => e.type === 'text' && !e.hidden).map((e) => e.font));
    const { defs, body } = renderDoc(doc, Object.assign({ idPrefix: 'x-' }, opts));
    const css = fontFaceCss(families, doc.fonts);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(doc.width)}pt" height="${num(doc.height)}pt" viewBox="0 0 ${num(doc.width)} ${num(doc.height)}"><defs><style>${css}</style>${defs}</defs>${body}</svg>`;
  }

  window.BZRender = { renderDoc, exportSvg, bounds, textHeight, vectorColors, vectorSource, fontFaceCss, normColor, paintAttr };
})();
