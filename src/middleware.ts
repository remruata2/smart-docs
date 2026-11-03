import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { UserRole } from "./generated/prisma";

// Build a per-request Content-Security-Policy.
//
// The nonce is what makes this effective: modern browsers ignore
// 'unsafe-inline' as soon as a nonce is present, so only scripts carrying the
// nonce (all of Next.js' own inline/streamed scripts, which Next tags
// automatically when the CSP request header carries a nonce) may run.
// 'unsafe-inline' is kept purely as a fallback for very old browsers.
//
// Critically, `data:` is NOT allowed in script-src, so a
// <script src="data:text/javascript;base64,..."> payload (the
// ClickFix/EtherHiding injection that hit this app) is refused by the browser.
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function setCsp(res: NextResponse, csp: string): NextResponse {
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js reads the nonce from this request header and applies it to the
  // script tags it renders.
  requestHeaders.set("Content-Security-Policy", csp);

  const continueWithCsp = () =>
    setCsp(NextResponse.next({ request: { headers: requestHeaders } }), csp);
  const redirectWithCsp = (to: string) =>
    setCsp(NextResponse.redirect(new URL(to, req.url)), csp);

  // Public routes that don't need auth checks
  if (path.startsWith("/api/seed")) {
    return continueWithCsp();
  }

  // Skip auth check for API auth routes to prevent loops
  if (path.startsWith("/api/auth")) {
    return continueWithCsp();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  const isAuthRoute = path === "/login";
  const isDashboardRoute = path.startsWith("/dashboard");
  const isAdminRoute = path.startsWith("/admin");

  // Authenticated users hitting the login page go to the dashboard
  if (isAuthRoute && token) {
    return redirectWithCsp("/dashboard");
  }

  // Unauthenticated users are kept out of protected areas server-side
  if ((isDashboardRoute || isAdminRoute) && !token) {
    return redirectWithCsp("/login");
  }

  // Legacy /dashboard URLs map onto /admin
  if (isDashboardRoute) {
    if (path === "/dashboard") {
      return redirectWithCsp("/admin");
    }
    if (path.startsWith("/dashboard/")) {
      return redirectWithCsp(path.replace("/dashboard", "/admin"));
    }
  }

  // Admin area is admin-only
  if (isAdminRoute && token && token.role !== UserRole.admin) {
    return redirectWithCsp("/unauthorized");
  }

  return continueWithCsp();
}

export const config = {
  matcher: [
    // Run on every route except static assets and files with an extension.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|css|js|map|woff|woff2|ttf|otf)$).*)",
  ],
};
