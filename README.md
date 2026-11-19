# frietsense

An interactive 3D concept of a potato fry line, run three ways:

- **Manual** – one operator samples each line about once an hour.
- **Qualify** – inline cameras measure every potato and alert the operator.
- **Qualify + AutoControl** – the camera reading adjusts the peeler on its own.

A scoreboard compares over-peeling, off-spec product, foreign material, operator interventions and time to detect and fix a change in raw material. Pull the cord at the top right for the dark-factory view.

Live at **https://www.frietsense.com**. All numbers are illustrative, from a toy model.

## Views

| URL | What it shows |
|---|---|
| `/` | Two production lines, one operator |
| `/?lines=1` | A single production line |

Controls: drag to orbit, scroll or `+`/`-` to zoom, shift-drag or right-drag to pan, `0` to reset the view.

## Run locally

It's a plain static site with no build step:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly from disk also works in most browsers.

## Files

```
index.html          page markup
css/style.css       styles and @font-face rules
js/app.js           scene, simulation and UI
vendor/three.min.js three.js r149 (MIT, see vendor/LICENSE-three.txt)
fonts/              Bricolage Grotesque and Figtree, self-hosted (SIL OFL, see fonts/)
og-image.png        link-preview image
CNAME               custom domain for GitHub Pages
```

Fonts are self-hosted rather than loaded from Google Fonts, so visitors' IP addresses aren't sent to a third party.

## Deploy

GitHub Pages serves the `main` branch from the repository root. Every push to `main` goes live within a minute or two.

Demo concept by Nico.
