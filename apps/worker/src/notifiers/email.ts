import nodemailer from "nodemailer";
import { formatDuration, type AlertEvent, type Notifier } from "@pulse/core";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Build the email (pure, unit-tested). Uses the Pulse palette and inline styles for mail clients. */
export function emailContent(e: AlertEvent, hasInlineImage: boolean) {
  const opened = e.kind === "opened";
  const subject = opened ? `[Pulse] DOWN: ${e.checkName} (${e.projectName})` : `[Pulse] RECOVERED: ${e.checkName} after ${formatDuration(e.durationMs ?? 0)}`;
  const colour = opened ? "#E24B4A" : "#1D9E75";
  const img = opened ? (hasInlineImage ? "cid:failure-screenshot" : e.screenshot?.url) : null;
  const rows: [string, string][] = [
    ["Project", e.projectName],
    ["Check", e.checkName],
    ...(e.url ? ([["URL", e.url]] as [string, string][]) : []),
    ["Started", new Date(e.startedAt).toUTCString()],
    ...(!opened && e.resolvedAt ? ([["Resolved", new Date(e.resolvedAt).toUTCString()], ["Downtime", formatDuration(e.durationMs ?? 0)]] as [string, string][]) : []),
    ...(opened && e.failingStep ? ([["Failing step", e.failingStep]] as [string, string][]) : []),
    ...(opened && e.error ? ([["Error", e.error]] as [string, string][]) : []),
  ];
  const html = `<!doctype html><html><body style="margin:0;background:#FBFAF8;font-family:Inter,Segoe UI,Arial,sans-serif;color:#17161C">
<div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #ECE9E4;border-radius:14px;overflow:hidden">
  <div style="padding:20px 24px;border-bottom:1px solid #ECE9E4">
    <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colour};margin-right:8px"></span>
    <strong style="font-size:18px">${esc(opened ? `${e.checkName} is down` : `${e.checkName} recovered`)}</strong>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:14px">${rows
    .map(([k, v]) => `<tr><td style="padding:10px 24px;color:#6B6875;width:120px;vertical-align:top">${esc(k)}</td><td style="padding:10px 24px;word-break:break-word">${esc(v)}</td></tr>`)
    .join("")}</table>
  ${img ? `<div style="padding:16px 24px"><img src="${esc(img)}" alt="Screenshot of the failing step" style="width:100%;border-radius:10px;border:1px solid #ECE9E4"></div>` : ""}
  ${e.statusPageUrl ? `<div style="padding:16px 24px 24px"><a href="${esc(e.statusPageUrl)}" style="display:inline-block;background:#17161C;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-size:14px">View status page</a></div>` : ""}
</div></body></html>`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n") + (e.statusPageUrl ? `\n\n${e.statusPageUrl}` : "");
  return { subject, html, text };
}

export function emailNotifier(smtpUrl: string, from: string, to: string): Notifier {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    channel: "email",
    async send(e) {
      const png = e.kind === "opened" ? e.screenshot?.png : null;
      const { subject, html, text } = emailContent(e, Boolean(png));
      await transport.sendMail({
        from,
        to,
        subject,
        html,
        text,
        attachments: png ? [{ filename: "failure.png", content: Buffer.from(png), cid: "failure-screenshot" }] : [],
      });
    },
  };
}
