# Soft Ring Lab

An interactive soft-body physics toy built with plain SVG and JavaScript, no build step.

- **Swipe up** on the ring (or scroll, or press ↑/↓) to stretch it from the inside with a round expander. Let go and it springs back.
- **O, V and A rings**, each with its own stiffness, stretch limit, softness and colour. Tweaks are remembered per shape.
- **High tear resistance**: springs stiffen sharply as they approach the stretch limit, so the ring locks up instead of failing. An integrity meter only drops if you push well past the limit, and it heals at rest.
- **Muscle rhythm**: the ring tightens with a quick squeeze and relaxes slowly, at an adjustable tempo and tone.

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Deploy

`.github/workflows/pages.yml` publishes the site to GitHub Pages on every push to `main`.
In the repository's **Settings → Pages**, set **Source** to **GitHub Actions** if it isn't already.
