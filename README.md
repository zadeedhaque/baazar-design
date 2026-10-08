# Baazar flyer template

An editable version of the Baazar A4 flyer ("Halal groceries delivered today"). Every part of the
flyer is its own layer: text, shapes, the logo, every icon, the badges, the photos and the QR codes.
You can move, resize, rotate, recolour, replace or delete any of them, and add new ones.

## Open it

Double-click `index.html`. It runs in Chrome, Edge, Safari or Firefox, needs no install, and works
offline: fonts, icons and photos are bundled in `js/data/`.

## Editing

- **Click** selects a whole block, such as a category card, the header or the offer box.
  **Double-click** selects one element inside it:
  - on text, you type straight onto the flyer
  - on a photo, you choose a replacement image
  - on an icon, the icon picker opens
- **Drag** to move; elements snap to the page centre and to each other (hold `Alt` to turn snapping off).
  Corner handles resize, the round handle on top rotates.
- **Properties** (right-hand panel) has every setting for the selected element:
  - **Text:** wording, font, weight, size, spacing, alignment, outline, and solid or gradient colour
  - **Shapes:** fill (solid or gradient with transparency), corner radius, border and shadow
  - **Photos:** replace, crop, zoom, pan, rounded corners and fading edges
  - **Icons and vector artwork:** swap from 1,500+ line icons or the flyer's own artwork,
    recolour each colour separately, change line width, import any SVG file, or edit the SVG code
- **Layers** (left-hand panel) lists everything. Drag rows to change stacking order, 👁 hides, 🔒 locks.
  The two background photos (leaves/road strip and phone/city/van) start locked so they don't get
  in the way. Unlock them there to edit them.
- **With nothing selected**, the panel shows every colour used in the flyer. Changing one there
  swaps it everywhere: text, shapes, gradients and icons.
- **Shortcuts:**

  | Keys | Action |
  | --- | --- |
  | `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
  | `Ctrl+D` | Duplicate |
  | `Ctrl+C` / `Ctrl+V` | Copy / paste |
  | `Del` | Delete |
  | Arrow keys | Nudge (`Shift` = 10 pt) |
  | `Ctrl+G` / `Ctrl+Shift+G` | Group / ungroup |
  | `[` / `]` | Send backward / bring forward |
  | `Esc` | Deselect |
  | `T` / `R` / `E` / `I` | Add text / rectangle / circle / icon |

Work autosaves in the browser. Use **Export ▸ Save project** to keep a `.json` file you can reopen
later or on another computer (**Export ▸ Open project…**).

## Exporting

| Option | Use it for |
| --- | --- |
| PNG / JPG, 300 dpi (2480 × 3508 px) | Printing, sending to a printer |
| PNG, social / screen (1080 px wide) | Instagram, Facebook, WhatsApp |
| PDF | Opens the print dialog. Choose *Save as PDF*, A4, margins *None*. Text stays as real, sharp text. |
| SVG | A layered vector file that opens in Illustrator, Figma, Inkscape or Affinity for further editing |

## Fonts

The original flyer uses the commercial fonts *Touche* and *Crostan*. The template substitutes
the free fonts Poppins (headline and body) and Lilita One ("Download our app"). If you own the
originals, load them with **Export ▸ Upload a font…** and pick them from the Font list on any text.
Montserrat and Anton are also bundled.

## Photos

The product photos, phone, van and city are cut from the original flyer's background image, at that
image's resolution (about 128 dpi at print size). They look fine on screen and in normal prints. For
a large or premium print run, replace them with higher-resolution photos (double-click a photo).

## Project layout

```
index.html            the editor
css/editor.css        editor styles
js/template.js        the flyer layout: every element, position, colour and font
js/render.js          turns the layout into SVG (used by the canvas and all exports)
js/editor.js          editor behaviour
js/data/*.js          bundled photos, vector artwork, fonts and icons (generated)
assets/photos/        photo crops from the original flyer
assets/vectors/       logo, flags, pin, skyline, badges and icons lifted from the original PDF
assets/badges/        QR codes and app-store badges
assets/icons/         extra line icons (cow, sheep, chicken, spice jar)
assets/fonts/         Poppins, Montserrat, Lilita One, Anton (SIL Open Font License)
vendor/lucide/        Lucide icon set (ISC license)
tools/                scripts that rebuild the assets
```

To change the starting design for everyone, edit `js/template.js`. To rebuild the bundled data after
adding or changing files in `assets/`:

```
python3 tools/build_bundle.py
```

To re-extract the artwork and photos from the original Illustrator PDF (needs `pip install pymupdf pillow`):

```
python3 tools/extract_from_pdf.py path/to/flyer.pdf
python3 tools/build_bundle.py
```
