# CocoaShot user guide

## Getting started

Open an image with **Open image**, by dropping it onto the window, or by pasting from the clipboard. Tools are on the left, grouped by task. The selected tool's settings are on the right. Layers are under the tools.

Hold Space and drag, or use the scroll wheel, to move around. Hold Ctrl (Cmd on a Mac) and scroll to zoom. **F11** switches to full screen (Esc leaves it) and **Tab** hides or shows the side panels, so the two together give the image the whole screen.

## Interface styles

**Settings, General, Interface** switches between three layouts. Each works with the dark and light theme.

- **Classic**: tools listed by task on the left, settings and layers on the right.
- **Photoshop style**: a slim icon toolbar on the left. A small triangle marks a group of tools: hold the button or right-click it to pick another. The last tool used becomes the button's face, and pressing a tool's key again cycles through its group. The options bar along the top holds the brush size, hardness, opacity, flow, pressure and smoothing; drag a label sideways to change its value. The icons on the right open Properties, History, Adjustments, Levels, Layer alpha and Background. The grip above the tools switches to two columns.
- **SAI style**: two compact columns. The first holds the Navigator (drag in it to move around, with zoom and rotation sliders) and Layers. The second holds the colour wheel, the tools as named buttons (pick a group with the small icons above them), the tool's settings and brush size presets.

Several images can be open at once. Each has a tab with its own layers and undo history. Middle-click a tab to close it.

## View rotation, zoom and smoothing

**View, Rotate view** turns the canvas on screen without changing the image, and **Flip view** mirrors it, which helps when drawing. The SAI toolbar and Navigator also rotate it. The **Zoom** tool zooms in on a click and out on Alt-click; **Hand** drags the view.

**Smoothing** (Stabilizer in SAI style) steadies brush strokes; higher numbers smooth more. **Minimum size** sets how thin a pressure stroke can get, and pen pressure can control size, opacity or both.

## Common tasks

### Remove a background

1. Choose **Background**, then **Remove background**.
2. Check the result. Switch between Transparent, Mask and Overlay at the bottom of the image.
3. To fix an edge, choose **Refine edges** and paint with Keep or Remove. Restore brings back what the AI found.
4. Export as PNG to keep the transparency.

The first time, CocoaShot asks to download the model. After that it works offline.

### Replace a background

After removing it, choose **Replace** and pick a colour, an image or a blur of the original.

### Highlight something

Choose **Highlight & Outline**, then **Highlight**. Pick a colour and drag a rectangle or ellipse, or paint with the brush. Marker style keeps text underneath readable. **Spotlight** dims everything except the area you drag.

### Outline an object

Remove the background first, or select the object. In **Outline**, choose **Outline layer** or **Outline selection**. **Find subject** does the selecting for you. Thickness, position, style, glow and colour stay editable while the outline layer is selected.

### Crop, straighten and resize

**Crop** offers free cropping, fixed ratios and social media sizes. Drag the frame or its handles, then **Apply crop** or double-click. **Resize** changes the pixel size. **Perspective** straightens something photographed at an angle.

### Retouch

**AI Tools, Remove object**: paint over what should disappear. **Cleanup**: paint over dust and scratches, or reduce noise. **Upscale** enlarges with added detail. **Enhance** improves exposure, colour and sharpness in one step.

### Paint and draw

**Paint & Erase** has a brush, pencil, eraser, fill, colour picker, clone, blur, sharpen and smudge. Painting on the photo creates a new paint layer so the photo stays untouched. **Lock transparency** paints only where the layer already has pixels. **Clip to layer below** shows the layer only inside the one beneath it.

### Brush size and opacity

With any brush, hold **Ctrl** (Cmd on a Mac) and drag left or right to change the size, or hold **Alt** and drag to change the opacity. The brush preview shows the new value as you drag. With Clone, a plain Alt-click still sets the source. In Refine edges, Alt still swaps Keep and Remove, so only Ctrl-drag applies there. `[` and `]` also change the size.

### Levels

**Adjustments, Levels** (Ctrl+L) sets the black point, white point and midtones of the image below the adjustment layer, for all colours together or for Red, Green or Blue alone. Output black and white compress the range. The **Alpha** channel does the same for transparency. **Auto** stretches the selected channel to its histogram.

### Layer alpha

**Adjustments, Layer alpha** (Ctrl+Shift+A, or the alpha button above the layers) edits the transparency of the selected image or paint layer: alpha levels, grow or shrink, feather, hard edges and invert. **Show alpha as black and white** shows the layer's transparency directly. With a selection, only the selected area changes. Changes preview live; **Apply** keeps them as one undo step, **Cancel** puts them back. Switching tools also applies them.

### Text and annotations

Choose a tool in **Text & Annotations** and click or drag on the image. Click text to edit it. Each annotation is its own layer and can be moved later with **Move**.

## Cut, copy and paste

With a selection, **Ctrl+X** copies the selected part of the current layer to the clipboard and removes it from the layer. Ctrl+C copies, Ctrl+V pastes as a new layer.

## Updates

The desktop app looks for a newer version on GitHub when it starts and offers to install it. Most updates are under 1 MB and only need a quick restart; occasionally a full installer is needed. **Help, Check for updates** checks at any time. The automatic check can be turned off in **Settings, About**.

## Saving

**Save project** writes a `.cocoashot` file that keeps every layer, mask and text editable. **Export** writes a flat PNG, JPG, WEBP, TIFF or BMP for sharing. Your original image is never changed.

Unsaved work is backed up every few minutes. If CocoaShot closes unexpectedly, the start screen offers to recover it.

## Shortcuts

Every shortcut can be changed in **Settings, Shortcuts**.
