"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, Reorder, motion } from "framer-motion";
import { STEP_ACTIONS, validateJourney, type JourneyStep, type StepAction } from "@pulse/core";
import { getSupabase } from "@/lib/supabase";
import type { ProjectView } from "@/lib/types";

type Draft = {
  project_id: string;
  name: string;
  type: "http" | "browser";
  url: string;
  method: "GET" | "HEAD" | "POST";
  expected_status: number;
  max_response_ms: number | "";
  interval_minutes: number;
  timeout_ms: number;
  retries: number;
  enabled: boolean;
  mode: "steps" | "script";
  script: string;
  steps: (JourneyStep & { key: string })[];
};

const ACTION_HINT: Record<StepAction, { selector?: boolean; value?: string; url?: boolean }> = {
  goto: { url: true },
  click: { selector: true },
  fill: { selector: true, value: "Text (use {{env.NAME}} for secrets)" },
  press: { selector: true, value: "Key, e.g. Enter" },
  select: { selector: true, value: "Option value" },
  check: { selector: true },
  waitForSelector: { selector: true },
  expectVisible: { selector: true },
  expectText: { selector: true, value: "Text that should appear" },
  expectUrl: { url: true },
  wait: { value: "Milliseconds" },
};

let keySeq = 0;
const k = () => `s${++keySeq}`;

const TEMPLATE: JourneyStep[] = [
  { name: "Open home page", action: "goto", url: "/" },
  { name: "Search", action: "fill", selector: "input[type=search], input[name=q]", value: "jar" },
  { name: "Submit search", action: "press", selector: "input[type=search], input[name=q]", value: "Enter" },
  { name: "See results", action: "expectVisible", selector: "main" },
];

export function CheckEditor({ initial, checkId, readOnly = false }: { initial?: Record<string, unknown> | null; checkId?: string; readOnly?: boolean }) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [d, setD] = useState<Draft>(() => {
    const i = (initial ?? {}) as Partial<Record<string, unknown>>;
    const steps = (i.steps as JourneyStep[] | null) ?? TEMPLATE;
    return {
      project_id: (i.project_id as string) ?? "",
      name: (i.name as string) ?? "",
      type: (i.type as Draft["type"]) ?? "http",
      url: (i.url as string) ?? "",
      method: (i.method as Draft["method"]) ?? "GET",
      expected_status: (i.expected_status as number) ?? 200,
      max_response_ms: (i.max_response_ms as number | null) ?? "",
      interval_minutes: (i.interval_minutes as number) ?? 5,
      timeout_ms: (i.timeout_ms as number) ?? 15000,
      retries: (i.retries as number) ?? 1,
      enabled: (i.enabled as boolean) ?? true,
      mode: i.script ? "script" : "steps",
      script: (i.script as string) ?? "",
      steps: steps.map((s) => ({ ...s, key: k() })),
    };
  });

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || readOnly) return;
    sb.from("projects").select("id, name, slug, is_public").order("name").then(({ data }) => {
      setProjects((data ?? []) as ProjectView[]);
      if (!d.project_id && data?.[0]) setD((x) => ({ ...x, project_id: data[0]!.id }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  const set = <K extends keyof Draft>(key: K, v: Draft[K]) => setD((x) => ({ ...x, [key]: v }));
  const setStep = (key: string, patch: Partial<JourneyStep>) => setD((x) => ({ ...x, steps: x.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));

  const journey = useMemo(() => validateJourney(d.steps.map(({ key: _k, ...s }) => clean(s))), [d.steps]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (d.type === "browser" && d.mode === "steps" && !journey.ok) return setMsg({ ok: false, text: journey.errors.join(" · ") });
    const sb = getSupabase();
    if (!sb) return setMsg({ ok: false, text: "Supabase is not configured." });
    setSaving(true);
    const row = {
      project_id: d.project_id,
      name: d.name,
      type: d.type,
      url: d.url || null,
      method: d.method,
      expected_status: d.expected_status,
      max_response_ms: d.max_response_ms === "" ? null : d.max_response_ms,
      interval_minutes: d.interval_minutes,
      timeout_ms: d.timeout_ms,
      retries: d.retries,
      enabled: d.enabled,
      steps: d.type === "browser" && d.mode === "steps" ? journey.value : null,
      script: d.type === "browser" && d.mode === "script" ? d.script : null,
    };
    const { project_id, ...updatable } = row;
    const res = checkId ? await sb.from("checks").update(updatable).eq("id", checkId).select("id").single() : await sb.from("checks").insert(row).select("id").single();
    setSaving(false);
    if (res.error) return setMsg({ ok: false, text: res.error.message });
    setMsg({ ok: true, text: "Saved. The next scheduled run will pick it up." });
    if (!checkId) router.push(`/dashboard/checks/${res.data.id}`);
    void project_id;
  };

  const remove = async () => {
    if (!checkId || !confirm("Delete this check and all its history?")) return;
    const { error } = await getSupabase()!.from("checks").delete().eq("id", checkId);
    if (error) setMsg({ ok: false, text: error.message });
    else router.push("/dashboard");
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <fieldset disabled={readOnly} className="space-y-6">
        <div className="card grid gap-4 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <span className="label">Type</span>
            <div role="radiogroup" aria-label="Check type" className="inline-flex rounded-full border border-line bg-bg p-1">
              {(["http", "browser"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={d.type === t}
                  onClick={() => set("type", t)}
                  className={`relative rounded-full px-4 py-1.5 text-[14px] transition-colors ${d.type === t ? "text-ink" : "text-muted"}`}
                >
                  {d.type === t && <motion.span layoutId="type-pill" className="absolute inset-0 rounded-full bg-card shadow-soft" transition={{ type: "spring", bounce: 0.2, duration: 0.4 }} />}
                  <span className="relative">{t === "http" ? "URL check" : "User journey"}</span>
                </button>
              ))}
            </div>
          </div>
          <Field label="Name" id="name">
            <input id="name" className="field" required value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Checkout journey" />
          </Field>
          {!checkId && (
            <Field label="Project" id="project">
              <select id="project" className="field" required value={d.project_id} onChange={(e) => set("project_id", e.target.value)}>
                {projects.length === 0 && <option value="">Create a project on the overview first</option>}
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
          <Field label={d.type === "http" ? "URL" : "Base URL (relative step URLs resolve against this)"} id="url" wide>
            <input id="url" type="url" className="field" required={d.type === "http"} value={d.url} onChange={(e) => set("url", e.target.value)} placeholder="https://example.com" />
          </Field>
          {d.type === "http" && (
            <>
              <Field label="Method" id="method">
                <select id="method" className="field" value={d.method} onChange={(e) => set("method", e.target.value as Draft["method"])}>
                  {["GET", "HEAD", "POST"].map((m) => <option key={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Expected status" id="status">
                <input id="status" type="number" min={100} max={599} className="field" value={d.expected_status} onChange={(e) => set("expected_status", Number(e.target.value))} />
              </Field>
              <Field label="Response-time budget (ms, optional)" id="budget">
                <input id="budget" type="number" min={1} className="field" value={d.max_response_ms} onChange={(e) => set("max_response_ms", e.target.value === "" ? "" : Number(e.target.value))} placeholder="2000" />
              </Field>
            </>
          )}
        </div>

        <AnimatePresence initial={false}>
          {d.type === "browser" && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="card p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-[15px] font-semibold">Journey</h2>
                  <div className="flex gap-2 text-[13px]">
                    {(["steps", "script"] as const).map((m) => (
                      <button key={m} type="button" onClick={() => set("mode", m)} aria-pressed={d.mode === m} className={`rounded-full border px-3 py-1 ${d.mode === m ? "border-ink text-ink" : "border-line text-muted"}`}>
                        {m === "steps" ? "Step builder" : "Code journey"}
                      </button>
                    ))}
                  </div>
                </div>
                {d.mode === "script" ? (
                  <Field label="Script name (apps/worker/journeys/<name>.ts)" id="script">
                    <input id="script" className="field font-mono" value={d.script} onChange={(e) => set("script", e.target.value)} placeholder="acme-checkout" pattern="[A-Za-z0-9_\-]+" required />
                  </Field>
                ) : (
                  <>
                    <Reorder.Group axis="y" values={d.steps} onReorder={(steps) => set("steps", steps)} className="space-y-3">
                      {d.steps.map((s, idx) => {
                        const hint = ACTION_HINT[s.action];
                        return (
                          <Reorder.Item key={s.key} value={s} className="rounded-[12px] border border-line bg-bg p-3">
                            <div className="flex items-start gap-3">
                              <span className="serif mt-1.5 w-6 shrink-0 cursor-grab text-center text-[18px] text-muted" title="Drag to reorder" aria-hidden="true">{idx + 1}</span>
                              <div className="grid flex-1 gap-2 sm:grid-cols-[1.2fr_0.9fr_1.5fr]">
                                <input aria-label={`Step ${idx + 1} name`} className="field" value={s.name} onChange={(e) => setStep(s.key, { name: e.target.value })} placeholder="Step name" />
                                <select aria-label={`Step ${idx + 1} action`} className="field" value={s.action} onChange={(e) => setStep(s.key, { action: e.target.value as StepAction })}>
                                  {STEP_ACTIONS.map((a) => <option key={a}>{a}</option>)}
                                </select>
                                {hint.url ? (
                                  <input aria-label={`Step ${idx + 1} URL`} className="field font-mono text-[13px]" value={s.url ?? ""} onChange={(e) => setStep(s.key, { url: e.target.value })} placeholder="/login" />
                                ) : hint.selector ? (
                                  <input aria-label={`Step ${idx + 1} selector`} className="field font-mono text-[13px]" value={s.selector ?? ""} onChange={(e) => setStep(s.key, { selector: e.target.value })} placeholder="button[type=submit]" />
                                ) : <span />}
                                {hint.value && (
                                  <input aria-label={`Step ${idx + 1} value`} className="field sm:col-span-2" value={s.value ?? ""} onChange={(e) => setStep(s.key, { value: e.target.value })} placeholder={hint.value} />
                                )}
                                <input aria-label={`Step ${idx + 1} timeout`} type="number" min={100} max={120000} className="field" value={s.timeoutMs ?? ""} onChange={(e) => setStep(s.key, { timeoutMs: e.target.value ? Number(e.target.value) : undefined })} placeholder="Timeout ms (optional)" />
                              </div>
                              <button type="button" onClick={() => set("steps", d.steps.filter((x) => x.key !== s.key))} aria-label={`Remove step ${idx + 1}`} className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-card hover:text-down-ink">×</button>
                            </div>
                          </Reorder.Item>
                        );
                      })}
                    </Reorder.Group>
                    <button type="button" onClick={() => set("steps", [...d.steps, { key: k(), name: "", action: "click", selector: "" }])} className="mt-3 rounded-full border border-dashed border-line px-4 py-2 text-[14px] text-muted hover:text-ink">
                      + Add step
                    </button>
                    {!journey.ok && <ul className="mt-3 space-y-0.5 text-[13px] text-down-ink">{journey.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="card grid gap-4 p-5 sm:grid-cols-4">
          <Field label="Run every (minutes)" id="interval">
            <select id="interval" className="field" value={d.interval_minutes} onChange={(e) => set("interval_minutes", Number(e.target.value))}>
              {[5, 10, 15, 30, 60, 360, 1440].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
            </select>
          </Field>
          <Field label="Timeout per step (ms)" id="timeout">
            <input id="timeout" type="number" min={500} max={120000} className="field" value={d.timeout_ms} onChange={(e) => set("timeout_ms", Number(e.target.value))} />
          </Field>
          <Field label="Retries per run" id="retries">
            <select id="retries" className="field" value={d.retries} onChange={(e) => set("retries", Number(e.target.value))}>
              {[0, 1, 2, 3].map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <div>
            <span className="label">Enabled</span>
            <label className="inline-flex cursor-pointer items-center gap-2 pt-2 text-[14px]">
              <input type="checkbox" checked={d.enabled} onChange={(e) => set("enabled", e.target.checked)} className="h-4 w-4 accent-[rgb(var(--coral-ink))]" />
              {d.enabled ? "Running" : "Paused"}
            </label>
          </div>
          <p className="text-[13px] text-muted sm:col-span-4">
            A run fails only if every retry fails (with exponential backoff between attempts). An incident opens after 2 failed runs in a row and resolves after 2 passes.
          </p>
        </div>
      </fieldset>

      {msg && <p role={msg.ok ? "status" : "alert"} className={`rounded-[10px] px-4 py-3 text-[14px] ${msg.ok ? "bg-up-soft text-up-ink" : "bg-down-soft text-down-ink"}`}>{msg.text}</p>}

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button className="pill-primary" disabled={saving}>{saving ? "Saving…" : checkId ? "Save changes" : "Create check"}</button>
          {checkId && <button type="button" onClick={remove} className="text-[14px] text-down-ink underline-offset-2 hover:underline">Delete check</button>}
        </div>
      )}
    </form>
  );
}

function clean(s: JourneyStep): JourneyStep {
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== "" && v !== undefined)) as unknown as JourneyStep;
}

function Field({ label, id, children, wide }: { label: string; id: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label htmlFor={id} className="label">{label}</label>
      {children}
    </div>
  );
}
