/**
 * Example code journey: log in, search, add to cart, see it in the cart.
 * Reference it from a check with `script = 'acme-checkout'`.
 *
 * Wrap each user-visible action in step(name, fn) — Pulse times every step,
 * applies the per-step timeout and screenshots the page if it fails.
 */
import type { CodeJourney } from "../src/runners/browser";

const journey: CodeJourney = async ({ page, step, baseUrl, env }) => {
  const base = baseUrl ?? "http://localhost:3012";

  await step("Open login page", async () => {
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  });

  await step("Log in", async () => {
    await page.getByPlaceholder("Email").fill(env.ACME_EMAIL ?? "bot@pulse.dev");
    await page.getByPlaceholder("Password").fill(env.ACME_PASSWORD ?? "correct-horse");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.getByRole("heading", { name: /Welcome/ }).waitFor();
  });

  await step("Search for “jar”", async () => {
    await page.getByLabel("Search").fill("jar");
    await page.getByTestId("search-btn").click();
    await page.getByTestId("product").first().waitFor();
  });

  await step("Add to cart", async () => {
    await page.getByTestId("product").first().getByRole("button", { name: "Add to cart" }).click();
    await page.waitForURL(/\/cart$/);
  });

  await step("Cart shows 1 item", async () => {
    const count = await page.getByTestId("cart-count").textContent();
    if (count?.trim() !== "1") throw new Error(`Expected 1 item in cart, saw ${count}`);
  }, { timeoutMs: 3000 });
};

export default journey;
