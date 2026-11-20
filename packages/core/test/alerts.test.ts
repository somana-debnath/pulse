import { describe, expect, it, vi } from "vitest";
import { MemoryAlertStore, alertDedupKey, dispatchAlert, type AlertEvent, type Notifier } from "../src/alerts";

const event: AlertEvent = {
  kind: "opened",
  incidentId: "inc-1",
  checkId: "chk-1",
  checkName: "Checkout journey",
  projectName: "Jars",
  projectSlug: "jars",
  url: "https://example.com",
  startedAt: new Date().toISOString(),
  failingStep: "Add to cart",
};

function fakeNotifier(channel: "discord" | "email", impl?: () => Promise<void>): Notifier & { send: ReturnType<typeof vi.fn> } {
  return { channel, send: vi.fn(impl ?? (async () => {})) };
}

describe("alert deduplication", () => {
  it("keys are deterministic per incident, kind and channel", () => {
    expect(alertDedupKey("i", "opened", "discord")).toBe("i:opened:discord");
    expect(alertDedupKey("i", "opened", "discord")).not.toBe(alertDedupKey("i", "resolved", "discord"));
    expect(alertDedupKey("i", "opened", "discord")).not.toBe(alertDedupKey("i", "opened", "email"));
  });

  it("sends once per channel", async () => {
    const store = new MemoryAlertStore();
    const d = fakeNotifier("discord");
    const e = fakeNotifier("email");
    const out = await dispatchAlert(event, [d, e], store);
    expect(out.map((o) => o.status)).toEqual(["sent", "sent"]);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(e.send).toHaveBeenCalledTimes(1);
  });

  it("a replayed event is a duplicate and is not re-sent", async () => {
    const store = new MemoryAlertStore();
    const d = fakeNotifier("discord");
    await dispatchAlert(event, [d], store);
    const second = await dispatchAlert(event, [d], store);
    expect(second[0]!.status).toBe("duplicate");
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it("concurrent dispatches of the same event send exactly once", async () => {
    const store = new MemoryAlertStore();
    const d = fakeNotifier("discord", () => new Promise((r) => setTimeout(r, 10)));
    const results = await Promise.all(Array.from({ length: 5 }, () => dispatchAlert(event, [d], store)));
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(results.flat().filter((r) => r.status === "sent")).toHaveLength(1);
  });

  it("opened and resolved are separate alerts", async () => {
    const store = new MemoryAlertStore();
    const d = fakeNotifier("discord");
    await dispatchAlert(event, [d], store);
    await dispatchAlert({ ...event, kind: "resolved" }, [d], store);
    expect(d.send).toHaveBeenCalledTimes(2);
  });

  it("a failed send releases the claim so a later run retries", async () => {
    const store = new MemoryAlertStore();
    let fail = true;
    const d = fakeNotifier("discord", async () => {
      if (fail) throw new Error("Discord 502");
    });
    const first = await dispatchAlert(event, [d], store);
    expect(first[0]).toMatchObject({ status: "failed", error: "Discord 502" });
    fail = false;
    const second = await dispatchAlert(event, [d], store);
    expect(second[0]!.status).toBe("sent");
    expect(store.failures).toHaveLength(1);
    const third = await dispatchAlert(event, [d], store);
    expect(third[0]!.status).toBe("duplicate");
  });

  it("one failing channel does not block the others", async () => {
    const store = new MemoryAlertStore();
    const d = fakeNotifier("discord", async () => {
      throw new Error("boom");
    });
    const e = fakeNotifier("email");
    const out = await dispatchAlert(event, [d, e], store);
    expect(out.map((o) => o.status)).toEqual(["failed", "sent"]);
  });
});
