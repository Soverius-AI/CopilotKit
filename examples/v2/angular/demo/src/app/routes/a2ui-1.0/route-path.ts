export const EXPRESS_ROUTE = "a2ui-1.0";

/**
 * Whether the page loaded at the browser-inference route, as the router
 * resolves it: relative to the document base href, with or without a
 * trailing slash.
 */
export function isExpressRoutePath(pathname: string, baseURI: string) {
  const base = new URL(baseURI).pathname.replace(/\/*$/, "/");
  if (!pathname.startsWith(base)) return false;
  const path = pathname.slice(base.length).replace(/\/+$/, "");
  return path === EXPRESS_ROUTE || path === `${EXPRESS_ROUTE}/evaluation`;
}
