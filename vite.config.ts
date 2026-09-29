import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

/**
 * The React Router build: Framework Mode with no dev server of its own.
 *
 * `pnpm dev`/`pnpm start` boot through the Effect server (see `main.ts`),
 * which mounts Vite in middleware mode for development; `react-router dev`
 * is not the intended entry point.
 */
export default defineConfig({
  plugins: [reactRouter()],
});
