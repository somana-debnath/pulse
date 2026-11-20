import { formatDuration, withRetry, type AlertEvent, type Notifier } from "@pulse/core";

const RED = 0xe24b4a;
const GREEN = 0x1d9e75;

/** Build the Discord webhook payload (pure, unit-tested). */
export function discordPayload(e: AlertEvent, hasAttachment: boolean) {
  const opened = e.kind === "opened";
  const fields = [
    { name: "Check", value: e.checkName, inline: true },
    { name: "Project", value: e.projectName, inline: true },
    opened
      ? { name: "Started", value: `<t:${Math.floor(Date.parse(e.startedAt) / 1000)}:R>`, inline: true }
      : { name: "Downtime", value: formatDuration(e.durationMs ?? 0), inline: true },
  ];
  if (opened && e.failingStep) fields.push({ name: "Failing step", value: e.failingStep.slice(0, 1024), inline: false });
  if (opened && e.error) fields.push({ name: "Error", value: "```" + e.error.slice(0, 900) + "```", inline: false });

  const image = hasAttachment ? { url: "attachment://failure.png" } : e.screenshot?.url ? { url: e.screenshot.url } : undefined;
  return {
    username: "Pulse",
    embeds: [
      {
        title: opened ? `🔴 ${e.checkName} is down` : `🟢 ${e.checkName} recovered`,
        url: e.statusPageUrl ?? undefined,
        description: opened
          ? `Failed 2 runs in a row${e.url ? ` on ${e.url}` : ""}.`
          : `Passing again after ${formatDuration(e.durationMs ?? 0)} of downtime.`,
        color: opened ? RED : GREEN,
        fields,
        image: opened ? image : undefined,
        timestamp: opened ? e.startedAt : (e.resolvedAt ?? new Date().toISOString()),
        footer: { text: "Pulse synthetic monitoring" },
      },
    ],
    allowed_mentions: { parse: [] as string[] },
  };
}

export function discordNotifier(webhookUrl: string): Notifier {
  return {
    channel: "discord",
    async send(e) {
      const png = e.kind === "opened" ? e.screenshot?.png : null;
      const body = new FormData();
      body.set("payload_json", JSON.stringify(discordPayload(e, Boolean(png))));
      if (png) body.set("files[0]", new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" }), "failure.png");
      await withRetry(
        async () => {
          const res = await fetch(webhookUrl, { method: "POST", body, signal: AbortSignal.timeout(10_000) });
          if (res.status === 429 || res.status >= 500) throw new Error(`Discord HTTP ${res.status}`);
          if (!res.ok) throw Object.assign(new Error(`Discord HTTP ${res.status}: ${await res.text()}`), { fatal: true });
        },
        { attempts: 3, baseDelayMs: 1000, shouldRetry: (err) => !(err as { fatal?: boolean }).fatal },
      );
    },
  };
}
