/**
 * "Acme Shop" — a tiny local site used by the integration tests and the Docker demo.
 * Its health can be toggled at runtime so we can watch Pulse open and resolve incidents:
 *
 *   up             everything works
 *   down           every page returns 503
 *   broken-search  pages load, but the search button is gone (a mid-journey failure)
 *   slow           pages take 3s to respond (exercises timeouts)
 *
 * Toggle with:  POST /__pulse/mode?set=down   (or open http://localhost:3012/__pulse)
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type SiteMode = "up" | "down" | "broken-search" | "slow";
export const SITE_MODES: SiteMode[] = ["up", "down", "broken-search", "slow"];

export interface TestSite {
  url: string;
  port: number;
  mode: () => SiteMode;
  setMode: (m: SiteMode) => void;
  close: () => Promise<void>;
}

const PRODUCTS = [
  { id: "jar-1", name: "Glass savings jar", price: 18 },
  { id: "jar-2", name: "Copper coin jar", price: 24 },
  { id: "mug-1", name: "Heartbeat mug", price: 14 },
];

function layout(title: string, body: string, cartCount = 0): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} · Acme Shop</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px system-ui;margin:0;background:#fbfaf8;color:#17161c}header{display:flex;gap:16px;align-items:center;padding:16px 24px;border-bottom:1px solid #ece9e4}
main{padding:24px;max-width:720px}a{color:#c9441d}input,button{font:inherit;padding:8px 12px;border-radius:8px;border:1px solid #ccc}button{background:#17161c;color:#fff;border:0}
.card{background:#fff;border:1px solid #ece9e4;border-radius:14px;padding:16px;margin:12px 0}</style></head>
<body><header><strong>Acme Shop</strong><a href="/">Home</a><a href="/login">Log in</a><a href="/cart" data-testid="cart-link">Cart (<span data-testid="cart-count">${cartCount}</span>)</a></header>
<main>${body}</main></body></html>`;
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((c) => c.trim().split("="))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k!, decodeURIComponent(v.join("="))]),
  );
}

async function readBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString());
}

export async function startTestSite(opts: { port?: number; mode?: SiteMode; host?: string } = {}): Promise<TestSite> {
  let mode: SiteMode = opts.mode ?? "up";

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, html: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
      res.end(html);
    };

    // control plane — always available
    if (url.pathname === "/__pulse/mode") {
      const next = url.searchParams.get("set") as SiteMode | null;
      if (next && SITE_MODES.includes(next)) mode = next;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ mode }));
    }
    if (url.pathname === "/__pulse") {
      return send(
        200,
        layout(
          "Control",
          `<h1>Test site control</h1><p>Current mode: <b>${mode}</b></p>` +
            SITE_MODES.map((m) => `<form method="post" action="/__pulse/mode?set=${m}" style="display:inline"><button>${m}</button></form> `).join(""),
        ),
      );
    }
    if (url.pathname === "/health") {
      res.writeHead(mode === "down" ? 503 : 200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: mode !== "down" }));
    }

    if (mode === "down") return send(503, "<h1>503 Service Unavailable</h1>");
    if (mode === "slow") await new Promise((r) => setTimeout(r, 3000));

    const cookies = parseCookies(req);
    const cart = cookies.cart ? cookies.cart.split(",").filter(Boolean) : [];
    const user = cookies.user;

    if (url.pathname === "/") {
      const search =
        mode === "broken-search"
          ? `<input name="q" placeholder="Search products" aria-label="Search">`
          : `<input name="q" placeholder="Search products" aria-label="Search"> <button type="submit" data-testid="search-btn">Search</button>`;
      return send(200, layout("Home", `<h1>Welcome${user ? `, ${user}` : ""}</h1><form action="/search" method="get">${search}</form>`, cart.length));
    }
    if (url.pathname === "/login" && req.method === "GET") {
      return send(
        200,
        layout(
          "Log in",
          `<h1>Log in</h1><form method="post" action="/login"><p><input type="email" name="email" placeholder="Email" required></p>
<p><input type="password" name="password" placeholder="Password" required></p><button type="submit">Log in</button></form>`,
          cart.length,
        ),
      );
    }
    if (url.pathname === "/login" && req.method === "POST") {
      const body = await readBody(req);
      if (body.get("password") !== "correct-horse") return send(401, layout("Log in", `<p role="alert">Wrong password</p>`));
      res.writeHead(303, { location: "/", "set-cookie": `user=${encodeURIComponent(body.get("email") ?? "")}; Path=/; HttpOnly` });
      return res.end();
    }
    if (url.pathname === "/search") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const hits = PRODUCTS.filter((p) => p.name.toLowerCase().includes(q));
      return send(
        200,
        layout(
          "Search",
          `<h1>Results for “${q}”</h1>${hits
            .map(
              (p) =>
                `<div class="card" data-testid="product"><h2>${p.name}</h2><p>$${p.price}</p><form method="post" action="/cart/add"><input type="hidden" name="id" value="${p.id}"><button type="submit">Add to cart</button></form></div>`,
            )
            .join("") || "<p>No results</p>"}`,
          cart.length,
        ),
      );
    }
    if (url.pathname === "/cart/add" && req.method === "POST") {
      const body = await readBody(req);
      const next = [...cart, body.get("id") ?? ""].join(",");
      res.writeHead(303, { location: "/cart", "set-cookie": `cart=${encodeURIComponent(next)}; Path=/` });
      return res.end();
    }
    if (url.pathname === "/cart") {
      const items = cart.map((id) => PRODUCTS.find((p) => p.id === id)).filter(Boolean);
      return send(
        200,
        layout("Cart", `<h1>Your cart</h1>${items.map((p) => `<div class="card">${p!.name}</div>`).join("") || "<p>Empty</p>"}<button>Checkout</button>`, cart.length),
      );
    }
    return send(404, layout("Not found", "<h1>Not found</h1>"));
  };

  const server: Server = createServer((req, res) => {
    handler(req, res).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    mode: () => mode,
    setMode: (m) => (mode = m),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
