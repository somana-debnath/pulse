import Link from "next/link";
import { SiteHeader, GITHUB_URL } from "@/components/SiteHeader";
import { HeartbeatLine } from "@/components/HeartbeatLine";
import { Reveal } from "@/components/Reveal";
import { HeroIntro, LiveStatusCard } from "@/components/landing/Hero";
import { HeartbeatIcon } from "@/components/Logo";
import { demoDashboardChecks } from "@/lib/demo";

export const revalidate = 3600;

const STEPS = [
  {
    title: "Describe a journey",
    body: "A URL to ping, or a real user flow: open the site, log in, search, add to cart. Write it in the dashboard or as a Playwright script.",
  },
  {
    title: "Pulse runs it on repeat",
    body: "Every few minutes from GitHub Actions — no server to keep alive. Each step is timed, retried with backoff, and screenshotted if it fails.",
  },
  {
    title: "Get pinged when it breaks",
    body: "Two failures in a row opens an incident and pings Discord and email with the failing step and a screenshot. Two passes resolves it.",
  },
];

const FEATURES = [
  { title: "No false alarms", body: "In-run retries with exponential backoff, per-step timeouts, and the 2-in-a-row rule before anything is called an outage." },
  { title: "Screenshots of the break", body: "The exact page at the exact step that failed — attached to the alert, kept on the incident." },
  { title: "Honest uptime", body: "Time-based uptime and p50/p95 computed in Postgres, merged across overlapping incidents so nothing is double-counted." },
  { title: "Exactly-once alerts", body: "Idempotent run recording and deduplicated alerts mean a retried job never double-counts or double-pings." },
  { title: "Public status pages", body: "90-day uptime bars, response-time charts and incident history for every project, shareable by URL." },
  { title: "Free to run", body: "Supabase free tier for data, GitHub Actions cron for scheduling. Or `docker compose up` on your own box." },
];

const CODE = `// apps/worker/journeys/checkout.ts
export default async ({ page, step }) => {
  await step("Open the shop", () => page.goto("/"));
  await step("Search", async () => {
    await page.getByLabel("Search").fill("jar");
    await page.getByRole("button", { name: "Search" }).click();
  });
  await step("Add to cart", () =>
    page.getByRole("button", { name: "Add to cart" }).first().click());
  await step("Cart shows 1 item", () =>
    page.getByTestId("cart-count").filter({ hasText: "1" }).waitFor(),
    { timeoutMs: 3000 });
};`;

export default function Landing() {
  const checks = demoDashboardChecks().filter((c) => ["d3", "d5", "d1", "d7"].includes(c.id));
  return (
    <>
      <SiteHeader />
      <main id="main">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="mx-auto max-w-6xl px-4 pb-6 pt-16 text-center sm:px-6 sm:pt-24">
            <HeroIntro />
          </div>
          <HeartbeatLine className="mx-auto mt-4 h-16 w-full max-w-5xl sm:h-20" />
        </section>

        {/* Live card + steps */}
        <section id="how-it-works" className="mx-auto grid max-w-6xl scroll-mt-20 gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-14">
          <Reveal>
            <LiveStatusCard checks={checks} />
          </Reveal>
          <div>
            <Reveal>
              <h2 className="serif text-[40px] leading-[1.05] sm:text-[48px]">
                Monitoring that behaves <em className="text-coral-ink">like a person.</em>
              </h2>
              <p className="mt-4 max-w-md text-[16px] leading-relaxed text-muted">
                Pinging a homepage tells you the server is on. Pulse tells you whether people can actually sign in and check out.
              </p>
            </Reveal>
            <ol className="mt-8 space-y-6">
              {STEPS.map((s, i) => (
                <Reveal key={s.title} delay={0.08 * (i + 1)}>
                  <li className="flex gap-4">
                    <span className="serif grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-card text-[20px] text-coral-ink">{i + 1}</span>
                    <div>
                      <h3 className="text-[17px] font-semibold">{s.title}</h3>
                      <p className="mt-1 text-[15px] leading-relaxed text-muted">{s.body}</p>
                    </div>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <Reveal>
            <h2 className="serif max-w-2xl text-[40px] leading-[1.05] sm:text-[48px]">
              Built to be trusted <em className="text-coral-ink">at 3am.</em>
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={0.05 * i}>
                <div className="card h-full p-6 transition-transform duration-300 hover:-translate-y-0.5">
                  <HeartbeatIcon className="h-5 w-5" />
                  <h3 className="mt-4 text-[17px] font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Code */}
        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center">
          <Reveal>
            <h2 className="serif text-[40px] leading-[1.05] sm:text-[48px]">
              Journeys are just <em className="text-coral-ink">Playwright.</em>
            </h2>
            <p className="mt-4 max-w-md text-[16px] leading-relaxed text-muted">
              Build simple flows in the dashboard with no code, or drop a script into the repo. Wrap each action in{" "}
              <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[14px] text-ink">step()</code> and Pulse times it, applies the timeout and grabs a screenshot if it fails.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/dashboard/checks/new" className="pill-primary">Create a check</Link>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="pill-outline">Read the docs</a>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <pre className="overflow-x-auto rounded-card bg-[#17161C] p-6 text-[13px] leading-relaxed text-[#E9E6E1] shadow-soft" tabIndex={0} aria-label="Example code journey">
              <code>{CODE}</code>
            </pre>
          </Reveal>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
          <Reveal>
            <div className="card relative overflow-hidden px-6 py-14 text-center sm:px-12">
              <h2 className="serif text-[40px] leading-[1.05] sm:text-[52px]">
                Your users shouldn&apos;t be <em className="text-coral-ink">your monitoring.</em>
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-[16px] text-muted">Open source, MIT licensed, and free to run on Supabase and GitHub Actions.</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/dashboard" className="pill-primary">Start monitoring</Link>
                <Link href="/status/demo" className="pill-outline">See a live status page</Link>
              </div>
              <HeartbeatLine className="pointer-events-none absolute inset-x-0 bottom-0 h-12 w-full opacity-40" />
            </div>
          </Reveal>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-[14px] text-muted sm:flex-row sm:px-6">
          <span className="flex items-center gap-2"><HeartbeatIcon className="h-4 w-4" /> Pulse · open-source synthetic monitoring</span>
          <nav aria-label="Footer" className="flex gap-6">
            <Link href="/status/demo" className="hover:text-ink">Status demo</Link>
            <Link href="/dashboard" className="hover:text-ink">Dashboard</Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-ink">GitHub</a>
          </nav>
        </div>
      </footer>
    </>
  );
}
