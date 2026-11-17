# CocoaShot

Image editing without the complexity. CocoaShot is the image editor of the Cocoa suite: a standalone desktop app for removing backgrounds, highlighting, outlining, cropping, resizing, retouching and annotating images, with AI tools that run entirely on your computer.

It shares its look and feel with CocoaAuthor.

## Features

- **Background removal**: one click, with ISNet (general), BiRefNet (maximum detail) or MODNet (people). Hair and fur detail is matched at full resolution. The background is hidden with an editable mask, so nothing is lost.
- **Refine**: Keep, Remove and Restore brushes, feather, smooth, shift edge, snap edges to detail, and transparent, mask and overlay previews.
- **Replace background**: colour, image or a blurred copy of the original.
- **Select**: rectangle, ellipse, lasso, polygon, brush select, magic wand, click to select an object (AI), select subject (AI), add, subtract, intersect, feather, grow or shrink, invert, copy to layer, delete, crop to selection.
- **Crop and resize**: free and fixed ratios, social media sizes, custom output size, straighten, rotate, flip, perspective correction, resize by pixels or percent with Lanczos resampling.
- **Free transform**: scale, rotate, flip and move a layer, or just the selected part of it, with handles or exact numbers. **Distort** moves each corner on its own, and **Warp** bends the layer with a grid of points (2 × 2 up to 6 × 6).
- **Step-by-step undo**: Ctrl+Z takes back the last action inside a tool before the document history, such as the last polygon corner, crop box change or transform handle drag.
- **Highlight and outline**: brush, rectangle and ellipse highlights, marker style, spotlight, and outlines that follow the real edge of an object (solid or dashed, outside, centre or inside, glow, rounded or sharp).
- **Paint and erase**: brush, pencil, eraser, fill, gradient (linear, radial, reflected, angle, diamond), colour picker, clone, blur, sharpen and smudge, with pen pressure, a colour wheel with RGB and hex input and recent colours, lock transparency and clipping to the layer below.
- **Adjustments**: exposure, brightness, contrast, highlights, shadows, whites, blacks, gamma, temperature, tint, saturation, vibrance, hue, sharpness, clarity, grayscale, sepia and invert, plus auto enhance, white balance, contrast and colour. Adjustments live on a layer and stay editable. GPU accelerated.
- **Filters**: Gaussian, motion and zoom blur, unsharp mask, add noise, pixelate, posterize, emboss, find edges and vignette, with a live preview. They follow the selection, and Ctrl+F repeats the last one.
- **AI tools**: remove objects (LaMa), heal spots and damage, reduce noise, upscale 2x or 4x (Swin2SR), one-step enhance, and find people, animals, vehicles and objects to select, highlight, outline or cut out.
- **Text and annotations**: text, arrows, lines, rectangles, ellipses, callouts, labels and numbered markers. Each is its own editable layer.
- **Layers**: image, paint, text, shape, highlight, outline, adjustment and background layers with visibility, rename, reorder, opacity, blend modes, duplicate, delete, merge down, merge visible, lock, masks (add, from selection, disable, invert, apply), lock transparency and clipping. Pick several layers with Ctrl- or Shift-click, and right-click a layer for its menu. Folders group layers (and other folders) and have their own visibility, opacity and blend mode.
- **Layer effects**: drop shadow, outer glow, stroke (outside, centre or inside), inner shadow and colour overlay. They stay editable and follow the layer as it changes.
- **History**: undo, redo and a history list for the whole session.
- **New image**: start from a blank canvas at any size up to 16384 px, with presets for screens, social media, print at 300 dpi and icons, and a white, black, transparent or any-colour background.
- **Files**: opens PNG, JPG, WEBP, AVIF, HEIC and HEIF (iPhone photos), BMP, TIFF, GIF (first frame), SVG, ICO, TGA and PSD (with layers and folders). Exports PNG, JPG, WEBP, AVIF, TIFF, BMP, PDF, ICO (every icon size) and PSD (with layers and folders), with quality, size, transparency, compression and colour tagging. Projects save as `.cocoashot` with layers, masks, text and settings intact.
- **Reliability**: autosave with crash recovery for every open image, non-destructive editing wherever possible, heavy work in background threads, cancellable AI tasks.

## Privacy

Everything runs on your computer. There is no account, no subscription, no telemetry and no upload. AI models are downloaded once, from huggingface.co or github.com, the first time a tool needs one, after you confirm. They are listed with their size and licence under Settings, AI models, where they can also be deleted.

| Model | Used for | Size | Licence |
| --- | --- | --- | --- |
| ISNet | Background removal | 179 MB | Apache-2.0 |
| BiRefNet Lite | Background removal, maximum detail | 224 MB | MIT |
| MODNet | Background removal for people | 26 MB | Apache-2.0 |
| SlimSAM | Click to select objects | 40 MB | Apache-2.0 |
| DETR ResNet-50 | Finding objects | 167 MB | Apache-2.0 |
| LaMa | Object removal and repair | 208 MB | Apache-2.0 |
| Swin2SR | Upscaling | 53 MB each for 2x and 4x | Apache-2.0 |

On Windows the AI tools use the graphics card through DirectML. Elsewhere they run on the CPU. BiRefNet needs a dedicated graphics card or about 16 GB of memory.

## Install

Download the installer for your system from the [latest release](https://github.com/CocoaSuite/CocoaShot/releases/latest), or build it yourself:

```sh
npm install
npm run dist:win     # Windows installer in release/
npm run dist:mac     # macOS dmg and zip
npm run dist:linux   # Linux AppImage and deb
```

Installers can only be built for the system you are on. The GitHub workflow in `.github/workflows/build.yml` builds all three. Run it from the Actions tab or by pushing a tag such as `v1.0.0`.

## Updates

The desktop app checks the latest GitHub release when it starts (this can be turned off in Settings, About) and from **Help, Check for updates**.

Most releases only change CocoaShot's own code. Each release therefore also carries a small code-only update (`cocoashot-app-<version>.json.gz`, about 3 MB, most of it the HEIC decoder and AVIF encoder) and a description of it (`cocoashot-app.json`). The update is built for one exact version of the parts CocoaShot runs on: Electron, the files in `electron/` and the packages. `scripts/shell-id.mjs` fingerprints those at build time. When an installed copy has the same fingerprint, it downloads only the small update, checks it against the release, unpacks it into its data folder and restarts. If the new code does not start, the next start goes back to the code that came with the installer. Installing a newer full version removes any downloaded code.

When those parts change (a new Electron, a changed package, or any edit in `electron/`), the fingerprint changes and the app downloads the full installer instead:

- Windows: closes CocoaShot and runs the new installer.
- Linux AppImage: replaces the AppImage and restarts. The deb package opens in the system installer.
- macOS: opens the new disk image to drag into Applications.

To publish an update, raise `version` in `package.json` (for example `npm version minor`), then push the matching tag (`git push --follow-tags`). The workflow builds all three systems, packs the code-only update and attaches everything to a GitHub release with that version. It refuses a tag that does not match `package.json`.

## Development

Requires Node.js 22.

```sh
npm install
npm run desktop     # build and run the desktop app
npm run typecheck
npm test
```

`npm run dev` serves the interface in a browser for quick UI work. AI tools and file dialogs need the desktop app.

## Structure

| Part | Location |
| --- | --- |
| Desktop app, file access, recovery | `electron/main.cjs`, `electron/preload.cjs` |
| Updates from GitHub releases | `electron/update.cjs`, `electron/appcode.cjs`, `scripts/`, `src/ui/update.ts` |
| AI processing (separate process) | `electron/ai.mjs` |
| User interface | `src/ui/` |
| Rendering engine (viewport) | `src/view/viewport.ts` |
| Image processing engine | `src/core/px.ts`, `src/core/gl.ts`, `src/core/brush.ts`, `src/core/compose.ts`, `src/core/transform.ts`, `src/core/worker.ts` |
| Layer effects | `src/core/fx.ts` |
| Document, layers, folders and history | `src/core/doc.ts`, `src/core/history.ts` |
| Project files and export | `src/core/io.ts`, `src/core/formats.ts` (HEIC, SVG, TGA, PSD, PDF, ICO, AVIF) |
| Tools | `src/tools/` |

New tools are added by writing a `Tool` (see `src/tools/types.ts`) and listing it in a group. New filters are added to `FILTERS` in `src/tools/filters.ts`.

Layers stay in one flat list, `doc.layers`, from bottom to top. A layer in a folder has the folder's id as its `parent`, and every folder sits directly above its contents (`normalizeTree` in `src/core/doc.ts` keeps it that way after each change), so code that only needs the stacking order can ignore folders. New AI models are added to `MODELS` in `electron/ai.mjs`.

See [docs/USER_GUIDE.md](docs/USER_GUIDE.md) and [docs/TESTING.md](docs/TESTING.md).
