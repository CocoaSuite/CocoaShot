# CocoaShot user guide

## Getting started

The first time CocoaShot opens, it says hello and gives a short tour of the window: the tools, your image, the tool settings, layers, and saving and exporting. The last step lets you switch to the Photoshop or SAI layout straight away (this is also in Settings, General).

Open an image with **Open image**, by dropping it onto the window, or by pasting from the clipboard. To start from nothing, use **New image** (Ctrl+N, or File, New image): give it a name, pick a preset or type a width and height in pixels, choose portrait or landscape, and pick a background (white, black, transparent, your front or back colour, or any colour). CocoaShot remembers your last choice. Images can be up to 16384 px on a side and 200 megapixels in total.

Tools are on the left, grouped by task. The selected tool's settings are on the right. Layers are under the tools.

Hold Space and drag, or use the scroll wheel, to move around. Hold Ctrl (Cmd on a Mac) and scroll to zoom. **F11** switches to full screen (Esc leaves it) and **Tab** hides or shows the side panels, so the two together give the image the whole screen.

## Settings

The **Settings** tab beside Properties and History has the everyday settings: theme, layout, rulers, guides and snapping, autosave, smoothing and the export format. **All settings** (or the gear at the top right, or Ctrl+,) opens the rest, including shortcuts and AI models.

## Language

CocoaShot speaks English and Russian. It starts in your computer's language (Russian on a Russian system, English otherwise), and the first-launch greeting follows it: «Привет» instead of hello. **Settings, General, Language** picks one for good; with no images open the window switches straight away, otherwise when CocoaShot next starts or after **Restart now**.

## Interface styles

**Settings, General, Interface** switches between three layouts. Each works with the dark and light theme.

- **Classic**: tools listed by task on the left, settings and layers on the right.
- **Photoshop style**: a slim icon toolbar on the left. A small triangle marks a group of tools: hold the button or right-click it to pick another. The last tool used becomes the button's face, and pressing a tool's key again cycles through its group. The options bar along the top holds the brush size, hardness, opacity, flow, pressure and smoothing; drag a label sideways to change its value. The icons on the right open Properties, History, Adjustments, Levels, Layer alpha and Background. The grip above the tools switches to two columns.
- **SAI style**: two compact columns. The first holds the Navigator (drag in it to move around, with zoom and rotation sliders) and Layers. The second holds the colour wheel, the tools as named buttons (pick a group with the small icons above them), the tool's settings and brush size presets.

Several images can be open at once. Each has a tab with its own layers and undo history. Middle-click a tab to close it.

**Undo** (Ctrl+Z) always takes back the last thing you did. While a tool still has work in progress, that comes first: the last polygon corner, the last crop box change, the last corner in Perspective, the last click with Object or Find objects, or the last handle drag or typed value in Free transform. After that, undo moves on to the image's history. **Redo** (Ctrl+Shift+Z or Ctrl+Y) steps forward again.

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

### Free transform

**Layer, Free transform** (Ctrl+T) puts a box with handles around the selected layer, or around the selected part of it if there is a selection. Drag inside the box to move, a handle to resize, or just outside a corner to rotate. Corners keep the proportions; hold Shift to resize freely, or to snap rotation to 15° steps. Alt resizes from the centre, and the arrow keys nudge. The panel takes exact sizes and angles, flips, and **Fit to image**. Enter or **Apply** keeps the change, Esc or **Cancel** puts it back. With a folder selected, everything in it (pixels, text and shapes) is scaled, turned and moved together; Distort and Warp work on one layer at a time. Text and shapes on their own are resized with **Move** instead.

### Move

**Move** (V) drags the selected layer. With a selection, only the selected pixels move, and the selection moves with them. With a folder selected, everything in it moves. The arrow keys nudge by 1 px, Shift+arrow by 10 px, and Shift-dragging keeps the move straight. Ctrl-click picks the layer under the cursor, or turn on **Pick layer by clicking** to do that with every click. Shift-click things in the image to pick several layers at once (Shift-click again takes one out, Esc clears the picks); they then move, nudge and turn together. Text and shapes show round handles to reshape them and a filled handle above them to turn them (Shift snaps to 15°); the text and shape panels also have a **Rotation** slider. A folder or several picked layers show one box with a turn handle above it, and **Free transform** (Ctrl+T) scales and turns them together. **Shift+H** and **Shift+V** (or **Layer, Flip horizontally** and **Flip vertically**) mirror the selected layer, folder or picked layers about the middle of their own box; with a selection on a pixel layer, only the selected pixels flip. Text moves to its mirrored place but stays readable. **Image, Flip image horizontally** and **vertically** still flip the whole image.

The **Scale**, **Distort** and **Warp** buttons at the top of the panel switch how the layer is reshaped. **Image, Distort** and **Image, Warp** (Ctrl+Alt+T) open them directly, and Ctrl-dragging a corner in Scale switches to Distort.

- **Distort** puts a handle on each corner and in the middle of each edge. Drag a corner to move it on its own, for example to fit a picture onto a sign or screen in a photo, or an edge to slide both its corners. Drag inside to move the whole layer, outside to rotate it.
- **Warp** lays a grid over the layer. Drag a grid point to bend the layer around it, or drag anywhere inside the grid to pull that part of the surface. Alt-drag inside moves the layer, drag outside rotates it. **Grid** sets how many cells it has, from 2 × 2 to 6 × 6, and keeps the bend you've made so far.

In both, Shift-click points to move several together, and the arrow keys nudge the picked points (or the whole layer when none are picked). **Reset** puts the shape back. Going from Scale to Distort to Warp carries the shape over; going back the other way applies it first.

### Folders

**New folder** (the folder button above the layers, or **Layer, New folder**) adds an empty folder. Drag a layer onto the middle of a folder to put it inside, or above or below another layer to take it out. **Layer, Put in folder** (Ctrl+G) wraps the selected layer in a new folder, and **Remove folder, keep layers** (Ctrl+Shift+G) undoes that. The arrow beside a folder opens or closes it. Ctrl-click layers to pick several, or Shift-click to pick a run of them; Delete, Put in folder and Merge then apply to all of them. **Merge down** (Ctrl+Alt+E) merges the selected layer into the one below, or merges all picked layers. **Merge visible** (Ctrl+Shift+Alt+E) merges everything that shows into one layer and leaves hidden layers alone. Right-click a layer for these and more, and Alt-click an eye to show only that layer (Alt-click again to show them all).

### Masks

**Layer, Add mask** gives the selected layer a mask that hides nothing; **Mask from selection** hides everything outside the selection. Paint the mask with Refine edges. The mask button on a layer turns the mask off and on; **Invert mask**, **Apply mask** (makes it permanent) and **Delete mask** are in the Layer menu and the right-click menu. Hiding, locking or fading a folder affects everything in it, and adjustment layers inside a folder only change the layers below them in that folder.

### Layer effects

**Layer, Layer effects**, the **fx** button above the layers, or a double-click on a layer's thumbnail opens the effects for the selected layer: **Drop shadow**, **Outer glow**, **Stroke** (outside, centre or inside the edge), **Inner shadow** and **Colour overlay**. Each one switches on with its toggle. Effects follow the layer when you paint, move or transform it, and the **fx** mark in the layers list opens them again. Export, Flatten and PSD export apply them.

### Filters

The **Filter** menu has Gaussian blur, Motion blur, Zoom blur, Unsharp mask, Add noise, Chromatic aberration, Lens distortion, Pixelate, Posterize, Emboss, Find edges, Halftone and Vignette. The selected filter shows in the panel on the right with a live preview; **Apply** keeps it, **Cancel** puts the layer back, and switching tools applies it. **Fade** mixes the result with the original. With a selection, only the selected area changes. **Ctrl+F** applies the last filter again with the same settings.

**Add noise** has a grain size (larger grain is softer) and Gaussian or Uniform grain; the preview keeps the same grain while you move sliders, and **New grain** shuffles it. **Chromatic aberration** pulls red and blue apart, outward from the centre or along an angle. **Lens distortion** bulges (positive) or pinches (negative) the image; **Zoom to fill** avoids empty corners.

### Curves

**Adjustments, Curves** (Ctrl+M) reshapes brightness for all colours together (RGB) or for Red, Green or Blue alone. Click the curve to add a point, drag points to bend it, and drag a point off the graph (or double-click it) to remove it. **Preset** has common shapes such as Medium contrast and Faded film. Curves live on the adjustment layer with the other adjustments, so they stay editable.

### Gradient map

**Adjustments, Gradient map** recolours the image by brightness: shadows take the colours at the left of the gradient, highlights those at the right. Pick a preset or set your own colour stops, then lower **Amount** to blend it with the original colours.

### Redact

**Highlight & Outline, Redact** (also in the Image menu) hides private details for good. Drag boxes over what to hide, or use **Find faces**, **Find people** or **Use selection**; click a box to leave it out. Choose **Solid box**, **Blur** or **Pixelate**, a rectangle or ellipse, and a margin, then **Redact**. The hidden pixels are replaced, so they cannot be recovered from the exported image. For text such as names or numbers, Solid box is the safest.

### Expand canvas

**Crop & Resize, Expand** (also in the Image menu) adds room around the image: type how much on each side, or pick a quick size such as **To 4:5**. The new area is filled with **AI** (desktop app: it continues backgrounds, sky and walls best), **Stretch edges**, the background **Colour**, or left transparent. In **Crop**, **Allow the frame outside the image** offers the same fills for the areas the frame adds.

### Rulers and guides

**View, Rulers** (Ctrl+R) shows rulers in pixels. Drag from a ruler onto the image to add a guide. With **Move**, drag a guide to place it or drag it back onto the ruler to remove it. **View, Clear guides** removes them all. When **Snap** is on, a moved layer lines up its edges and centre with guides, the image edges and centre, and other layers; hold Alt to move freely. Guides are saved in the project.

### Actions

**File, Actions** (Alt+F9) records and replays a series of edits. Type a name and press **Record**, edit as usual (resize, crop, expand, filters, adjustments, background removal, redaction, enhance, export and more), then press **Stop** in the top bar. **Play** runs the action on the current image; **Play on all** runs it on every open image, one after another. Each step of an action is listed and can be removed. Ready-made actions (Web ready, Blur all faces, Square for social media, Film look) can be played directly or added to your own.

### Gradients

Choose **Paint & Erase, Gradient** (Shift+G) and drag across the image. Pick the shape (linear, radial, reflected, angle or diamond) and whether it runs from the front colour to the back colour, from the front colour to transparent, or through a rainbow. Hold Shift to keep the line straight. With a selection, only the selected area is filled.

### Paint and draw

**Paint & Erase** has a brush, pencil, eraser, fill, colour picker, clone, blur, sharpen and smudge. Painting on the photo creates a new paint layer so the photo stays untouched. **Lock transparency** paints only where the layer already has pixels. **Clip to layer below** shows the layer only inside the one beneath it. Clone is **Aligned** by default: the source keeps its distance from the brush from one stroke to the next (turn it off to start every stroke at the source point), and **Sample all layers** copies from the whole picture rather than the selected layer.

**Select, Brush select** paints a selection; Alt-paint, or the Subtract button, takes away from it.

### Brush size and opacity

With any brush, hold **Ctrl** (Cmd on a Mac) and drag left or right to change the size, or hold **Alt** and drag to change the opacity. The brush preview shows the new value as you drag. A plain Alt-click with Brush, Pencil, Fill or Gradient picks the colour under the cursor, like the Colour picker. With Clone, a plain Alt-click still sets the source. In Refine edges, Alt still swaps Keep and Remove, so only Ctrl-drag applies there. `[` and `]` also change the size.

### Levels

**Adjustments, Levels** (Ctrl+L) sets the black point, white point and midtones of the image below the adjustment layer, for all colours together or for Red, Green or Blue alone. Output black and white compress the range. The **Alpha** channel does the same for transparency. **Auto** stretches the selected channel to its histogram.

### Layer alpha

**Adjustments, Layer alpha** (Ctrl+Shift+A, or the alpha button above the layers) edits the transparency of the selected image or paint layer: alpha levels, grow or shrink, feather, hard edges and invert. **Show alpha as black and white** shows the layer's transparency directly. With a selection, only the selected area changes. Changes preview live; **Apply** keeps them as one undo step, **Cancel** puts them back. Switching tools also applies them.

### Text and annotations

Choose a tool in **Text & Annotations** and click or drag on the image. Click text to edit it. Each annotation is its own layer and can be moved later with **Move**.

## Cut, copy and paste

With a selection, **Ctrl+X** copies the selected part of the current layer to the clipboard and removes it from the layer. Ctrl+C copies (just the selected area, with masks applied), Ctrl+V pastes as a new layer. Something copied in CocoaShot pastes back in the same place; other images are centred, and only images larger than this one are shrunk to fit.

Delete removes the selected pixels, or, with no selection, the selected layer (Ctrl+Z brings it back).

## Updates

The desktop app looks for a newer version on GitHub when it starts and offers to install it. Most updates are a few MB and only need a quick restart; occasionally a full installer is needed. **Help, Check for updates** checks at any time. The automatic check can be turned off in **Settings, About**.

## Saving

**Save project** writes a `.cocoashot` file that keeps every layer, mask and text editable. **Export** writes a PNG, JPG, WEBP, AVIF, TIFF, BMP, PDF or ICO for sharing, or a PSD that keeps layers and folders for other editors. CocoaShot opens all of these except PDF, plus HEIC photos from iPhones, SVG drawings and TGA files. Your original image is never changed.

Unsaved work is backed up every few minutes. If CocoaShot closes unexpectedly, the start screen offers to recover it.

## Shortcuts

Every shortcut can be changed in **Settings, Shortcuts**.
