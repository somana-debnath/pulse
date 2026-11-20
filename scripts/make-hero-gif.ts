/**
 * Generates README/marketing assets with Playwright:
 *   apps/web/public/demo/failure.png  — a real failure screenshot from the test site (used by demo incidents)
 *   docs/hero.gif                     — the landing hero with the heartbeat line drawing itself
 *   docs/screenshots/*.png            — landing, status page, dashboard (light + dark, desktop + mobile)
 *
 * Usage: start the web app (npm run build && npm start -w @pulse/web), then `npm run gif`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { PNG } from "pngjs";
// @ts-expect-error gifenc ships without types
import gifenc from "gifenc";
const { GIFEncoder, applyPalette, quantize } = gifenc;
import { startTestSite } from "../apps/test-site/src/server";

const APP = process.env.PULSE_URL ?? "http://localhost:3011";
const browser = await chromium.launch();
await mkdir("docs/screenshots", { recursive: true });
await mkdir("apps/web/public/demo", { recursive: true });

// 1. Real failure screenshot: the broken-search page the journey fails on.
{
  const site = await startTestSite({ mode: "broken-search" });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(site.url);
  await page.screenshot({ path: "apps/web/public/demo/failure.png" });
  await page.close();
  await site.close();
  console.log("✓ apps/web/public/demo/failure.png");
}

// 2. Hero GIF
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200); // let entrance animations finish
  // restart the heartbeat animation so the GIF starts at the beginning of a loop
  await page.evaluate(() => {
    document.querySelectorAll<SVGPathElement>(".heartbeat-path").forEach((p) => {
      p.style.animation = "none";
      void p.getBoundingClientRect();
      p.style.animation = "";
    });
  });
  const W = 1200, H = 700, FRAMES = 32, DELAY = 100; // 3.2s = one heartbeat loop
  const gif = GIFEncoder();
  for (let i = 0; i < FRAMES; i++) {
    const t0 = Date.now();
    const buf = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
    const { data } = PNG.sync.read(buf);
    const palette = quantize(data, 128);
    gif.writeFrame(applyPalette(data, palette), W, H, { palette, delay: DELAY });
    const spent = Date.now() - t0;
    if (spent < DELAY) await page.waitForTimeout(DELAY - spent);
  }
  gif.finish();
  await writeFile("docs/hero.gif", gif.bytes());
  await page.close();
  console.log("✓ docs/hero.gif");
}

// 3. Screenshots
const shots: { name: string; path: string; dark?: boolean; mobile?: boolean; full?: boolean }[] = [
  { name: "landing", path: "/", full: true },
  { name: "landing-dark", path: "/", dark: true },
  { name: "landing-mobile", path: "/", mobile: true, full: true },
  { name: "status", path: "/status/demo", full: true },
  { name: "status-dark", path: "/status/demo", dark: true, full: true },
  { name: "dashboard", path: "/dashboard", full: true },
  { name: "dashboard-dark", path: "/dashboard", dark: true },
  { name: "dashboard-mobile", path: "/dashboard", mobile: true, full: true },
  { name: "check", path: "/dashboard/checks/d5", full: true },
  { name: "new-check", path: "/dashboard/checks/new", full: true },
];
for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: s.mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 },
    deviceScaleFactor: s.mobile ? 2 : 1,
    colorScheme: s.dark ? "dark" : "light",
  });
  const page = await ctx.newPage();
  await page.goto(APP + s.path, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    // trigger whileInView reveals
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `docs/screenshots/${s.name}.png`, fullPage: s.full });
  await ctx.close();
  console.log(`✓ docs/screenshots/${s.name}.png`);
}

await browser.close();
