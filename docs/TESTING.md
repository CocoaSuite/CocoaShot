# Testing CocoaShot

## Automated

```sh
npm run typecheck
npm test
```

The unit tests cover curves and gradient maps, snapping, the seeded grain, the image processing core, freeform warp and distort maths, in-tool undo steps, blurring, mask growth and feathering, edge tracing, flood fill, inpainting, Lanczos resampling, perspective maths, histogram analysis, levels and alpha editing, the distance transform behind strokes and glows, and how folders keep their order when layers move in and out of them.

## Before a release

Run `npm run desktop` and work through this list with a photo of a person and a product shot.

0. First launch (clear the app's data folder, or run `localStorage.clear()` in the developer tools and restart): "hello" is written with the sound, then the tour rings each part of the window. Pick a layout on the last step. Restart: no hello. Open Settings and type hello: the tour runs again.
1. Open PNG, JPG, WEBP, AVIF, HEIC (an iPhone photo), TIFF, BMP, GIF, SVG, ICO, TGA and a layered PSD with folders. Drag and drop and clipboard paste also open images.
1a. File, New image (and Ctrl+N, and the start screen button): each preset, portrait and landscape, every background, a typed size, a size over 200 megapixels (Create is disabled), and that the next New image remembers the last choice.
2. Remove a background with each model. Refine with Keep, Remove and Restore. Change feather, smooth and shift edge. Check all three previews.
3. Replace the background with a colour, an image and a blur.
4. Make every kind of selection, then add, subtract, invert, grow and delete.
5. Crop with several ratios and a social size, straighten, rotate, flip, correct perspective and resize.
6. Add highlights, a spotlight and outlines from a layer, a selection and the image border. Edit an outline after creating it.
7. Paint with every brush, with and without pen pressure. Use lock transparency and clipping. Ctrl-drag to resize and Alt-drag to change opacity with each brush; Alt-click still sets the clone source.
8. Move every adjustment slider, use each auto button and compare before and after. In Levels, change each channel including Alpha, use Auto and the reset buttons.
8a. In Layer alpha, change every control on a cut-out layer, with and without a selection. Apply, Cancel, switch tools mid-edit and undo.
9. Remove an object, heal a spot, reduce noise, upscale, enhance and find objects.
10. Add every annotation type, edit text, move and reshape shapes.
11. Undo and redo through the whole session, including jumping in the History tab.
12. Save a project, close it, reopen it and check everything is still editable.
12a. Ctrl-click and Shift-click layers, merge down, merge visible, right-click a layer, Alt-click an eye. Add, disable, invert, apply and delete a mask.
12b. Move with a selection (only the selected pixels move), a folder, arrow keys and Shift+arrows. Turn text and a rectangle with the filled handle, then flip and rotate the image.
12c. Export twice with the same name (Replace and Keep both), and open two images, edit both, kill the app and check both come back.
13. Export to every format, with and without transparency, at a different size. Open the PSD in another editor and check its layers and folders; open the PDF and the ICO.
13a. Make folders inside folders, drag layers in and out, close and open them, hide, lock and fade a folder, duplicate and delete one, and use Put in folder and Remove folder. Undo each step.
13b. Turn on every layer effect on a cut-out, a painted stroke and a text layer. Paint, move and transform the layer and check the effects follow. Export and flatten.
13c. Run every filter with and without a selection, on a locked-transparency layer, then Cancel, Apply and Ctrl+F.
13d. Free transform a layer and a selection: resize from corners and edges, with Shift and Alt, rotate, flip, type exact values, Apply, Cancel and undo.
13f. Distort a layer, a selection and a masked cut-out: drag corners and edges, Ctrl-drag a corner from Scale, rotate outside, Shift-click two corners and nudge them. Warp the same with each grid size: drag points, pull the surface, change the grid mid-warp, Reset, Apply and Cancel. Check edges stay smooth after Apply.
13h. Curves: add, drag and remove points on RGB and each channel, use presets, undo. Gradient map: presets, add and remove stops, Amount, Reverse. Save, reopen and check both.
13i. Redact: Find faces on a group photo, Find people, Use selection and hand-drawn boxes; each style and shape; undo. Export and check the faces are gone.
13j. Expand canvas with every fill and quick size, then undo. Crop with the frame outside the image, straightened, with each fill.
13k. Rulers and guides: add guides from both rulers, move and remove them, snap a layer to a guide and to another layer, hold Alt, rotate and crop the image and check the guides follow. Save and reopen.
13l. Actions: record an action with a resize, a filter, curves and an export; play it on another image and on all open images; remove a step; play each ready-made action.
13m. Settings tab: change each setting there and check it sticks after a restart.
13g. Ctrl+Z inside tools: place polygon corners and undo them one at a time (and Backspace), then undo past the last corner into the history. Do the same with crop box drags, Perspective corners, Object clicks, Find objects toggles and each Free transform mode, then redo.
13e. Draw each gradient shape with each colour option, with a selection and with Shift.
14. Close without saving and check the recovery offer on the next start.
15. Open a 6000 by 4000 px photo and check the app stays responsive.
16. Switch Interface between Classic, Photoshop style and SAI style in dark and light. In each, pick tools, paint, change layers and open two images in tabs. In Photoshop style open a tool group by holding and by right-click, and cycle a group with its key. In SAI style use the Navigator, rotate and flip the view and paint while rotated, and click size presets.
17. Install an older build, publish a newer tagged release, and check Help, Check for updates downloads and installs it. With only `src/` changed it should offer the small update and restart into the new version; with a change in `electron/` it should offer the full installer.
