import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works both locally and on GitHub Pages
  // project sites such as https://<user>.github.io/dofour/.
  base: './',
});
