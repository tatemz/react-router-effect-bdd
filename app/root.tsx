import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { ReactNode } from "react";

import "./globals.css";

/**
 * The root route: the app-wide HTML shell and global stylesheet.
 *
 * The minimal Framework Mode root requires: every page (the greeting card)
 * is rendered inside this `<html>`/`<body>` scaffold, with the client
 * runtime (`Scripts`) that hydrates the feedback form for the reveal.
 *
 * @example
 * // React Router renders this automatically around every route; the home
 * // route's markup lands in `children`:
 * //   curl -s http://localhost:3456/ | head
 * //   # <html lang="en"><head>…<body>…<main id="message">Hello!</main>…
 */
export function Layout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/**
 * The root error boundary: the last-resort shell for loader/action throws.
 *
 * The app's own failures are carried in viewmodels, so reaching this means a
 * framework-level problem (a missing 404 route, a crashed module); the
 * message states that plainly.
 */
export function ErrorBoundary({
  error,
}: {
  readonly error: unknown;
}) {
  const is404 = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main>
      <h1>{is404 ? "404" : "Oops!"}</h1>
      <p>
        {is404
          ? "The requested page could not be found."
          : "An unexpected error occurred."}
      </p>
    </main>
  );
}
