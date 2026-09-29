import { type RouteConfig, index } from "@react-router/dev/routes";

/**
 * The route table: one index route, the greeting card.
 *
 * The BDD scenarios only ever visit `/`, and everything unmatched by an
 * Effect route renders through this router (see `server/reactRouterApp.ts`).
 */
export default [index("routes/home.tsx")] satisfies RouteConfig;
