# Disabled upstream workflows

These workflows come from upstream `basketikun/infinite-canvas` and were moved out of `.github/workflows/`
so GitHub Actions does not run them in the 点染 fork:

- `docker-image.yml` – pushes a Docker image to GHCR on tags
- `docs-docker-image.yml` – builds the upstream docs site image
- `github-pages.yml` – deploys to GitHub Pages
- `publish-plugins.yml` – publishes official plugins to the `plugins-dist` branch (点染 bundles them in `web/public/plugin-market/` instead)

Deployment is handled by Vercel (Git integration). To re-enable one, adapt it for `kobingogo/dianran` and move it back to `.github/workflows/`.
