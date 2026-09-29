import type { Config } from "@react-router/dev/config";

/**
 * Framework Mode with SSR on: every request renders server-side through the
 * Effect pipeline, and the client runtime hydrates the reveal form.
 */
export default {
  ssr: true,
} satisfies Config;
