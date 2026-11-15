# CocoaShot

Image editing without the complexity. CocoaShot is the image editor of the Cocoa suite: a standalone desktop app for removing backgrounds, highlighting, outlining, cropping, resizing, retouching and annotating images, with AI tools that run entirely on your computer.

It shares its look and feel with CocoaAuthor.

## Features

- **Background removal**: one click, with ISNet (general), BiRefNet (maximum detail) or MODNet (people). Hair and fur detail is matched at full resolution. The background is hidden with an editable mask, so nothing is lost.
- **Refine**: Keep, Remove and Restore brushes, feather, smooth, shift edge, snap edges to detail, and transparent, mask and overlay previews.
- **Replace background**: colour, image or a blurred copy of the original.
- **Select**: rectangle, ellipse, lasso, magic wand, click to select an object (AI), select subject (AI), add, subtract, intersect, feather, grow or shrink, invert, copy to layer, delete, crop to selection.
- **Crop and resize**: free and fixed ratios, social media sizes, custom output size, straighten, rotate, flip, perspective correction, resize by pixels or percent with Lanczos resampling.
- **Highlight and outline**: brush, rectangle and ellipse highlights, marker style, spotlight, and outlines that follow the real edge of an object (solid or dashed, outside, centre or inside, glow, rounded or sharp).
- **Paint and erase**: brush, pencil, eraser, fill, colour picker, clone, blur, sharpen and smudge, with pen pressure, a colour wheel with RGB and hex input and recent colours, lock transparency and clipping to the layer below.
- **Adjustments**: exposure, brightness, contrast, highlights, shadows, whites, blacks, gamma, temperature, tint, saturation, vibrance, hue, sharpness, clarity, grayscale, sepia and invert, plus auto enhance, white balance, contrast and colour. Adjustments live on a layer and stay editable. GPU accelerated.
- **AI tools**: remove objects (LaMa), heal spots and damage, reduce noise, upscale 2x or 4x (Swin2SR), one-step enhance, and find people, animals, vehicles and objects to select, highlight, outline or cut out.
- **Text and annotations**: text, arrows, lines, rectangles, ellipses, callouts, labels and numbered markers. Each is its own editable layer.
- **Layers**: image, paint, text, shape, highlight, outline, adjustment and background layers with visibility, rename, reorder, opacity, blend modes, duplicate, delete, lock, masks, lock transparency and clipping.
- **History**: undo, redo and a history list for the whole session.
- **Files**: opens PNG, JPG, WEBP, BMP, TIFF, GIF (first frame) and PSD (with layers). Exports PNG, JPG, WEBP, TIFF and BMP with quality, size, transparency, compression and colour tagging. Projects save as `.cocoashot` with layers, masks, text and settings intact.
- **Reliability**: autosave with crash recovery, non-destructive editing wherever possible, heavy work in background threads, cancellable AI tasks.

## Privacy

Everything runs on your computer. There is no account, no subscription, no telemetry and no upload. AI models are downloaded once, from huggingface.co or github.com, the first time a tool needs one, after you confirm. They are listed with their size and licence under Settings, AI models, where they can also be deleted.

| Model | Used for | Size | Licence |
| --- | --- | --- | --- |
| ISNet | Background removal | 179 MB | Apache-2.0 |
| BiRefNet Lite | Background removal, maximum detail | 224 MB | MIT |
| MODNet | Background removal for people | 26 MB | Apache-2.0 |
| SlimSAM | Click to select objects | 52 MB | Apache-2.0 |
| DETR ResNet-50 | Finding objects | 167 MB | Apache-2.0 |
| LaMa | Object removal and repair | 208 MB | Apache-2.0 |
| Swin2SR | Upscaling | 5 to 17 MB | Apache-2.0 |

On Windows the AI tools use the graphics card through DirectML. Elsewhere they run on the CPU. BiRefNet needs a dedicated graphics card or about 16 GB of memory.

## Install

Download the installer for your system from the latest build (Actions, Build installers, artifacts), or build it yourself:

```sh
npm install
npm run dist:win     # Windows installer in release/
npm run dist:mac     # macOS dmg and zip
npm run dist:linux   # Linux AppImage and deb
```

Installers can only be built for the system you are on. The GitHub workflow in `.github/workflows/build.yml` builds all three. Run it from the Actions tab or by pushing a tag such as `v1.0.0`.

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
| AI processing (separate process) | `electron/ai.mjs` |
| User interface | `src/ui/` |
| Rendering engine (viewport) | `src/view/viewport.ts` |
| Image processing engine | `src/core/px.ts`, `src/core/gl.ts`, `src/core/brush.ts`, `src/core/compose.ts`, `src/core/transform.ts`, `src/core/worker.ts` |
| Document, layers and history | `src/core/doc.ts`, `src/core/history.ts` |
| Project files and export | `src/core/io.ts` |
| Tools | `src/tools/` |

New tools are added by writing a `Tool` (see `src/tools/types.ts`) and listing it in a group. New AI models are added to `MODELS` in `electron/ai.mjs`.

See [docs/USER_GUIDE.md](docs/USER_GUIDE.md) and [docs/TESTING.md](docs/TESTING.md).
