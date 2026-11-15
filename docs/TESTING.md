# Testing CocoaShot

## Automated

```sh
npm run typecheck
npm test
```

The unit tests cover the image processing core: blurring, mask growth and feathering, edge tracing, flood fill, inpainting, Lanczos resampling, perspective maths, histogram analysis, levels and alpha editing.

## Before a release

Run `npm run desktop` and work through this list with a photo of a person and a product shot.

1. Open PNG, JPG, WEBP, TIFF, BMP, GIF and a layered PSD. Drag and drop and clipboard paste also open images.
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
13. Export to every format, with and without transparency, at a different size.
14. Close without saving and check the recovery offer on the next start.
15. Open a 6000 by 4000 px photo and check the app stays responsive.
16. Install an older build, publish a newer tagged release, and check Help, Check for updates downloads and installs it.
