// The default Baazar flyer, rebuilt as editable layers.
// Units are PDF points on an A4 page (595.276 x 841.89). Elements are listed back to front.
(function () {
  const C = {
    green: '#0b4331',
    deep: '#05331e',
    cream: '#fefbf3',
    page: '#fffcf6',
    gold: '#f4bf5e',
    card: '#fdf6e8',
    cardLine: '#efe1c4',
    ink: '#1f2a24',
  };
  const goldGrad = (angle = 90) => ({
    type: 'linear', angle,
    stops: [
      { offset: 0, color: '#ecb140', opacity: 1 },
      { offset: 1, color: '#f8c873', opacity: 1 },
    ],
  });
  const fadeRight = (from, to) => ({
    type: 'linear', angle: 90,
    stops: [
      { offset: 0, color: C.green, opacity: 1 },
      { offset: from, color: C.green, opacity: 1 },
      { offset: to, color: C.green, opacity: 0 },
    ],
  });

  const els = [];
  let n = 0;
  const add = (type, name, props) => {
    const el = Object.assign({ id: 'el' + (++n), type, name, x: 0, y: 0, w: 10, h: 10, rotation: 0, opacity: 1, locked: false, hidden: false }, props);
    els.push(el);
    return el;
  };
  const text = (name, t, props) => add('text', name, Object.assign({
    text: t, font: 'Poppins', size: 12, weight: 700, italic: false, fill: C.cream,
    align: 'left', letterSpacing: 0, lineHeight: 1.15, uppercase: false, fitWidth: false,
  }, props));
  const rect = (name, props) => add('rect', name, Object.assign({ fill: C.green, radius: 0, stroke: 'none', strokeWidth: 0 }, props));
  const image = (name, src, props) => add('image', name, Object.assign({ src: 'asset:' + src, fit: 'cover', radius: 0, zoom: 1, panX: 0, panY: 0, fadeTop: 0, fadeBottom: 0, fadeLeft: 0, fadeRight: 0 }, props));
  const vector = (name, key, props) => add('vector', name, Object.assign({ svg: 'asset:' + key, color: C.cream, strokeWidth: 2 }, props));
  const icon = (name, key, props) => add('vector', name, Object.assign({ svg: 'icon:' + key, color: C.cream, strokeWidth: 2 }, props));

  // Background photography (bottom of the stack)
  image('Bottom band (leaves, road)', 'bottom-band', { x: 0, y: 690, w: 595.276, h: 151.89, locked: true, group: 'background' });
  image('App phone, city & van', 'app-phone-city', { x: 281, y: 553, w: 314.276, h: 245, locked: true, group: 'background' });

  // Header
  rect('Logo panel', { x: 12, y: 4, w: 289, h: 90, radius: 12, fill: C.cream, group: 'header-logo' });
  vector('Baazar logo', 'logo', { x: 14, y: 7, w: 286, h: 85, group: 'header-logo' });
  vector('Flags', 'flags', { x: 196, y: 6, w: 97, h: 30, group: 'header-logo' });

  rect('Delivery panel', { x: 308, y: 9, w: 276, h: 86, radius: 12, fill: C.green, group: 'header-delivery' });
  vector('Location pin', 'pin', { x: 320, y: 18, w: 53, h: 68, group: 'header-delivery' });
  text('Delivery across', 'DELIVERY ACROSS', { x: 377, y: 23, w: 120, size: 13.6, weight: 600, letterSpacing: -0.03, fill: C.cream, group: 'header-delivery' });
  text('Melbourne Metro', 'MELBOURNE\nMETRO', { x: 376, y: 37, w: 120, size: 19.4, weight: 600, lineHeight: 1.08, letterSpacing: -0.02, fill: goldGrad(180), group: 'header-delivery' });
  vector('Melbourne skyline', 'skyline', { x: 492, y: 20, w: 90, h: 74, group: 'header-delivery' });

  // Hero
  rect('Hero panel', { x: 12, y: 98, w: 572, h: 195, radius: 12, fill: C.green, group: 'hero' });
  image('Hero photo', 'hero-meat', { x: 336, y: 98, w: 250, h: 195, radius: 12, fadeLeft: 62, group: 'hero' });
  text('Headline', 'HALAL GROCERIES', { x: 32, y: 103, w: 420, size: 47, weight: 800, italic: true, letterSpacing: -0.045, fitWidth: true, fill: C.cream, group: 'hero' });
  text('Sub-headline', 'DELIVERED TODAY', { x: 33, y: 156, w: 330, size: 43.5, weight: 800, letterSpacing: -0.04, fitWidth: true, fill: goldGrad(180), group: 'hero' });

  const badge = (label, key, cx, ix, iy, iw, ih) => {
    text(label.replace('\n', ' ') + ' label', label, { x: cx - 50, y: 206, w: 100, size: 7.6, weight: 700, lineHeight: 1.1, align: 'center', letterSpacing: -0.02, fill: C.cream, group: 'hero-badges' });
    vector(label.replace('\n', ' ') + ' badge', key, { x: ix, y: iy, w: iw, h: ih, group: 'hero-badges' });
  };
  badge('HALAL\nCERTIFIED', 'halal-badge', 73, 43, 222, 60, 60);
  badge('SAME DAY\nDELIVERY', 'clock-24', 157, 129, 226, 57, 55);
  badge('DELIVERY ACROSS\nMELBOURNE METRO', 'truck', 251, 217, 228, 69, 49);

  // Category cards
  const card = (title, sub, photo, iconKey, x0, y0, x1, y1, photoY, titleW) => {
    const g = 'card-' + photo;
    const w = x1 - x0, h = y1 - y0;
    rect(title + ' card', { x: x0, y: y0, w, h, radius: 9, fill: C.card, stroke: C.cardLine, strokeWidth: 0.7, group: g });
    image(title + ' photo', photo, { x: x0 + 1, y: photoY, w: w - 2, h: y1 - photoY - 1, radius: 8, fadeTop: 22, group: g });
    // Long titles are squeezed to the space left of the icon, like the condensed type in the original.
    const fit = title.length > 14 || !!titleW;
    text(title + ' title', title, { x: x0 + 8, y: y0 + 6, w: titleW || (fit ? w - 46 : w - 44), size: fit ? 12.4 : 13, weight: 800, letterSpacing: -0.035, fitWidth: fit, fill: C.green, group: g });
    text(title + ' details', sub, { x: x0 + 8, y: y0 + 22, w: w - 44, size: 7.8, weight: 500, lineHeight: 1.22, fill: C.ink, group: g });
    add('ellipse', title + ' icon circle', { x: x1 - 36, y: y0 + 6, w: 30, h: 30, fill: C.green, stroke: 'none', strokeWidth: 0, group: g });
    icon(title + ' icon', iconKey, { x: x1 - 30, y: y0 + 12, w: 18, h: 18, color: C.cream, strokeWidth: 1.6, group: g });
  };
  card('BEEF', 'Steaks, Curry Cuts,\nMince & More', 'beef', 'custom/cow', 13, 299, 156, 411, 338);
  card('LAMB', 'Chops, Leg, Shoulder\n& More', 'lamb', 'custom/sheep', 162, 299, 296, 411, 338);
  card('CHICKEN', 'Whole Chicken, Breast,\nWings, Thighs & More', 'chicken', 'custom/chicken', 302, 299, 439, 411, 338);
  card('SEAFOOD', 'Fresh & Frozen Fish,\nPrawns & More', 'seafood', 'lucide/fish', 445, 299, 584, 411, 338);
  card('RICE & GRAINS', 'Basmati, Chinigura,\nNazirshal & More', 'rice-grains', 'lucide/wheat', 13, 419, 159, 553, 455);
  card('SPICES & SEASONINGS', 'Masala, Whole Spices,\nPowders & More', 'spices', 'custom/spice-jar', 164, 419, 314, 553, 455);
  card('DAIRY & EGGS', 'Milk, Yogurt, Cheese,\nEggs & More', 'dairy-eggs', 'lucide/milk', 319, 419, 442, 553, 455, 70);
  card('FROZEN FOODS', 'Samosa, Paratha,\nSnacks & More', 'frozen', 'lucide/snowflake', 448, 419, 584, 553, 455, 84);
  card('PANTRY ESSENTIALS', 'Oil, Pulses, Sauces,\nCondiments & More', 'pantry', 'lucide/shopping-basket', 13, 560, 166, 696, 600);
  card('BAKING & DESSERTS', 'Flour, Sugar, Desserts\n& More', 'baking', 'lucide/cake-slice', 171, 560, 321, 696, 600);

  // Download the app
  rect('App panel', { x: 325, y: 555, w: 178, h: 161, radius: 12, fill: fadeRight(0.67, 1), group: 'app' });
  text('Download our app', 'DOWNLOAD OUR\nAPP NOW', { x: 327, y: 566, w: 143, size: 19.5, weight: 400, font: 'Lilita One', align: 'center', lineHeight: 1.12, fill: C.cream, group: 'app' });
  rect('App Store QR frame', { x: 335, y: 628, w: 59, h: 80, radius: 6, fill: '#ffffff', group: 'app' });
  image('App Store QR code', 'qr-app-store', { x: 338, y: 632, w: 52, h: 52, fit: 'contain', group: 'app' });
  image('App Store badge', 'badge-app-store', { x: 339, y: 688, w: 50, h: 17, fit: 'contain', radius: 3, group: 'app' });
  rect('Google Play QR frame', { x: 400, y: 628, w: 59, h: 80, radius: 6, fill: '#ffffff', group: 'app' });
  image('Google Play QR code', 'qr-google-play', { x: 403, y: 631, w: 54, h: 54, fit: 'contain', group: 'app' });
  image('Google Play badge', 'badge-google-play', { x: 404, y: 687, w: 52, h: 18, fit: 'contain', radius: 3, group: 'app' });

  // Offer
  rect('Offer panel', { x: 13, y: 701, w: 268, h: 91, radius: 14, fill: goldGrad(90), shadow: { blur: 6, y: 3, color: '#000000', opacity: 0.35 }, group: 'offer' });
  vector('Gift icon', 'gift', { x: 19, y: 717, w: 58, h: 60, group: 'offer' });
  text('Offer intro', 'NEW TO BAAZAR?', { x: 82, y: 716, w: 182, size: 12.4, weight: 700, align: 'center', letterSpacing: -0.02, fill: C.deep, group: 'offer' });
  text('Offer headline', 'GET $10 CREDIT', { x: 82, y: 729, w: 188, size: 28, weight: 800, letterSpacing: -0.06, fitWidth: true, fill: C.deep, group: 'offer' });
  text('Offer extra', '+  FREE FIRST DELIVERY', { x: 77, y: 760, w: 189, size: 18, weight: 800, letterSpacing: -0.07, fitWidth: true, fill: C.deep, group: 'offer' });

  // Footer
  rect('Quality bar', { x: 23, y: 801, w: 343, h: 35, radius: 14, fill: C.deep, group: 'footer-quality' });
  vector('Quality check badge', 'check-badge', { x: 50, y: 799, w: 37, h: 36, group: 'footer-quality' });
  text('Quality text', 'QUALITY YOU CAN TRUST', { x: 92, y: 806.5, w: 252, size: 19.2, weight: 700, letterSpacing: 0.01, fitWidth: true, fill: C.cream, group: 'footer-quality' });
  rect('Website pill', { x: 438, y: 798, w: 152, h: 38, radius: 19, fill: '#0a2f1d', group: 'footer-web' });
  vector('Globe icon', 'globe', { x: 448, y: 805, w: 24, h: 24, group: 'footer-web' });
  text('Website', 'baazar.com.au', { x: 476, y: 806, w: 108, size: 13.6, weight: 600, fill: C.cream, group: 'footer-web' });

  window.BZ_TEMPLATE = {
    version: 1,
    width: 595.276,
    height: 841.89,
    background: C.page,
    elements: els,
  };
})();
