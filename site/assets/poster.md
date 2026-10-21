# Poster and OG image

`poster.webp` (1600×900) and `og.png` (1200×630) are one render of the demo apartment (`src/demo/scene-data.ts`), made by the player itself, not drawn by hand. They are labelled as the demo apartment on the site.

- Date: 2026-10-21 (the invented demo apartment, presentation camera from the north).
- Capture: `scripts/site-poster.ts` serves the built demo page and opens `dist/index.html?lang=en`, then calls `window.jeexViewer.capture.still({ width: 1600, height: 900, camera: 'presentation', state: 'current' })`, keeping the default disclosure caption.
- Renderer: headless Chromium from `@playwright/test`. It uses SwiftShader by default; `JEEX_BROWSER_GPU=nvidia` renders on an NVIDIA GPU when the machine has one.
- Conversion (ImageMagick 7):

  ```bash
  bun run build
  JEEX_BROWSER_GPU=nvidia bun run scripts/site-poster.ts poster.png
  magick poster.png -quality 82 site/assets/poster.webp
  magick poster.png -resize 1200x675 -gravity south -crop 1200x630+0+0 +repage -strip site/assets/og.png
  ```

  The OG crop keeps the bottom edge so the disclosure caption stays in the picture. On a machine without an NVIDIA GPU, leave out `JEEX_BROWSER_GPU=nvidia`.

Re-render both when the demo scene or its presentation camera changes.
