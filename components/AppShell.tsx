"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { GanttPanel } from "@/components/GanttPanel";
import { RichText } from "@/components/RichText";
import { SAMPLE_SCOPE, SAMPLE_SCOPES } from "@/lib/demo-plan";
import { formatMoney, summarizeMoney } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/status";
import type { AgentAction, PaymentStatus, Project, RuntimeMode } from "@/lib/types";

interface ApiPayload {
  project: Project | null;
  mode: RuntimeMode;
  message?: string;
  error?: string;
}

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "err";
}

const SUGGESTIONS = ["What's unpaid?", "Invoice phase 1", "Push design back a week"];
const PLAN_STEPS = [
  "Reading the scope",
  "Pricing each phase",
  "Sequencing dependencies",
  "Validating the plan schema",
  "Laying out the Gantt",
];

async function postJson(url: string, body?: unknown): Promise<ApiPayload> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiPayload;
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function modeLabel(mode: RuntimeMode): string {
  const ai = mode.demoAi ? "Canned plan" : `Grok ${mode.model}`;
  const pay = mode.demoPaypal ? "Mocked PayPal" : `PayPal ${mode.paypalMode}`;
  return `${ai} · ${pay}`;
}

export function AppShell() {
  const [project, setProject] = useState<Project | null>(null);
  const [mode, setMode] = useState<RuntimeMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [planStep, setPlanStep] = useState(0);
  const [selectedId, setSelectedId] = useState<string>("");
  const [scope, setScope] = useState(SAMPLE_SCOPE);
  const [clientEmail, setClientEmail] = useState("billing@example.com");
  const [clientName, setClientName] = useState("Jordan");
  const [confirmNew, setConfirmNew] = useState(false);
  const [budget, setBudget] = useState("18000");
  const [pyusdNote, setPyusdNote] = useState(true);
  const [chatText, setChatText] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenEvents = useRef(new Set<string>());
  const chatRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLOListElement>(null);
  const [actionsOpen, setActionsOpen] = useState(true);
  const primed = useRef(false);
  const busyRef = useRef(false);
  busyRef.current = busy;

  function pushToast(text: string, tone: "ok" | "err" = "ok") {
    const id = Date.now() + Math.random();
    const clean = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "the client").replace(/\s+/g, " ").trim();
    const preview = clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
    setToasts((items) => [...items, { id, text: preview, tone }].slice(-1));
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, 6500);
  }

  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        const response = await fetch("/api/project");
        const payload = (await response.json()) as ApiPayload;
        if (dead) return;
        setProject(payload.project);
        setMode(payload.mode);
        setSelectedId(payload.project?.phases[0]?.id ?? "");
      } catch (loadError) {
        if (!dead) pushToast(loadError instanceof Error ? loadError.message : "Could not load the plan", "err");
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    if (!planning) return;
    const timer = window.setInterval(() => setPlanStep((step) => (step + 1) % PLAN_STEPS.length), 700);
    return () => window.clearInterval(timer);
  }, [planning]);

  useEffect(() => {
    if (!project) return;
    const events = project.events ?? [];
    if (!primed.current) {
      for (const event of events) seenEvents.current.add(event.id);
      primed.current = true;
      return;
    }
    for (const event of events) {
      if (seenEvents.current.has(event.id)) continue;
      seenEvents.current.add(event.id);
      pushToast(event.message, "ok");
    }
  }, [project]);

  const projectId = project?.id ?? "";
  useEffect(() => {
    if (!projectId) return;
    const timer = window.setInterval(() => {
      if (document.hidden || busyRef.current) return;
      void (async () => {
        try {
          const response = await fetch("/api/project");
          const payload = (await response.json()) as ApiPayload;
          if (payload.mode) setMode(payload.mode);
          setProject((current) => {
            if (!payload.project) return current;
            if (!current) return payload.project;
            const eventsChanged = (payload.project.events?.length ?? 0) !== (current.events?.length ?? 0);
            if (payload.project.updatedAt !== current.updatedAt || eventsChanged) return payload.project;
            return current;
          });
        } catch {
          // The next poll retries. A dropped tick should not cover the schedule.
        }
      })();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [projectId]);

  useEffect(() => {
    if (!project) return;
    if (!project.phases.some((phase) => phase.id === selectedId)) {
      setSelectedId(project.phases[0]?.id ?? "");
    }
  }, [project, selectedId]);

  const selected = project?.phases.find((phase) => phase.id === selectedId) ?? project?.phases[0];
  const pendingDrafts = useMemo(
    () => project?.drafts.filter((draft) => draft.status === "pending_approval") ?? [],
    [project],
  );
  const money = project ? summarizeMoney(project) : null;
  const messageCount = project?.messages.length ?? 0;
  const actionCount = project?.actions?.length ?? 0;

  useEffect(() => {
    const node = chatRef.current;
    if (!node) return;
    const scroll = () => {
      node.scrollTop = node.scrollHeight;
    };
    scroll();
    const frame = window.requestAnimationFrame(scroll);
    const timer = window.setTimeout(scroll, 60);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [messageCount, projectId]);

  useEffect(() => {
    const node = actionsRef.current;
    if (!node || !actionsOpen) return;
    const scroll = () => {
      node.scrollTop = node.scrollHeight;
    };
    scroll();
    const frame = window.requestAnimationFrame(scroll);
    const timer = window.setTimeout(scroll, 80);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [actionCount, projectId, actionsOpen]);

  useEffect(() => {
    setActionsOpen(pendingDrafts.length === 0);
  }, [pendingDrafts.length]);

  async function run(task: () => Promise<ApiPayload>) {
    setBusy(true);
    try {
      const payload = await task();
      setProject(payload.project);
      if (payload.mode) setMode(payload.mode);
      if (payload.message) pushToast(payload.message, "ok");
    } catch (taskError) {
      pushToast(taskError instanceof Error ? taskError.message : "Something went wrong", "err");
    } finally {
      setBusy(false);
    }
  }

  async function createPlan(event: FormEvent) {
    event.preventDefault();
    const amount = Number(budget);
    if (!Number.isFinite(amount) || amount <= 0) {
      pushToast("Enter a budget greater than zero.", "err");
      return;
    }
    setPlanning(true);
    setPlanStep(0);
    const started = Date.now();
    try {
      const payload = await postJson("/api/project", {
        scope,
        clientEmail,
        clientName: clientName.trim() || "Jordan",
        budget: amount,
        pyusdNote,
      });
      const wait = Math.max(0, 2400 - (Date.now() - started));
      await new Promise((resolve) => window.setTimeout(resolve, wait));
      setProject(payload.project);
      if (payload.mode) setMode(payload.mode);
      setSelectedId(payload.project?.phases[0]?.id ?? "");
      if (payload.message) pushToast(payload.message, "ok");
    } catch (taskError) {
      pushToast(taskError instanceof Error ? taskError.message : "Something went wrong", "err");
    } finally {
      setPlanning(false);
    }
  }

  async function sendChat(text: string) {
    const message = text.trim();
    if (!message) return;
    setChatText("");
    await run(() => postJson("/api/chat", { message }));
  }

  return (
    <main className="zilla-app mx-auto flex min-h-dvh flex-col px-3 py-3 md:px-4 lg:h-dvh lg:overflow-hidden">
      <header className="zilla-header mb-3 flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-lime text-ink">
            <span className="font-display text-2xl font-bold">Z</span>
          </div>
          <div>
            <p className="font-display text-xl font-semibold tracking-tight text-white md:text-2xl">
              Zilla OS <span className="text-zinc-500">/</span> Milestones module
            </p>
            <p className="text-sm text-lime">Get paid before the next phase starts</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {project?.clockDate ? (
            <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-amber-100">
              Demo clock {project.clockDate}
            </span>
          ) : null}
          {mode ? (
            <span className="rounded-full border border-line px-3 py-1 text-lime">{modeLabel(mode)}</span>
          ) : null}
          <Legend />
        </div>
      </header>

      {loading ? (
        <p className="grid flex-1 place-items-center text-sm text-zinc-300">Loading Zilla OS</p>
      ) : !project ? (
        <section className="panel mx-auto w-full max-w-3xl overflow-auto rounded-3xl p-6 md:p-8">
          <h1 className="font-display text-3xl text-white">Get paid before the next phase starts</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
            Paste a scope, a billing email, and a budget. Grok splits the work into payment-gated phases on a Bryntum
            Gantt. PayPal invoices unlock the next phase.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {SAMPLE_SCOPES.map((sample) => (
              <button
                key={sample.id}
                type="button"
                className="rounded-2xl border border-line bg-ink/60 px-4 py-3 text-left text-sm hover:border-lime/50"
                onClick={() => {
                  setScope(sample.scope);
                  setBudget(sample.budget);
                  setClientEmail(sample.email);
                  setClientName(sample.clientName);
                }}
              >
                <span className="block font-medium text-white">{sample.title}</span>
                <span className="text-zinc-400">{formatMoney(Number(sample.budget))}</span>
              </button>
            ))}
          </div>
          <form className="mt-5 space-y-4" onSubmit={createPlan}>
            <label className="block text-sm text-zinc-300">
              Project scope
              <textarea
                className="mt-2 h-40 w-full rounded-2xl border border-line bg-ink px-4 py-3 text-sm text-white outline-none ring-lime/40 focus:ring"
                value={scope}
                onChange={(event) => setScope(event.target.value)}
                required
              />
            </label>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="block text-sm text-zinc-300">
                Client name
                <input
                  className="mt-2 w-full rounded-2xl border border-line bg-ink px-4 py-3 text-sm text-white outline-none ring-lime/40 focus:ring"
                  value={clientName}
                  onChange={(event) => setClientName(event.target.value)}
                  required
                />
              </label>
              <label className="block text-sm text-zinc-300">
                Client billing email
                <input
                  type="email"
                  className="mt-2 w-full rounded-2xl border border-line bg-ink px-4 py-3 text-sm text-white outline-none ring-lime/40 focus:ring"
                  value={clientEmail}
                  onChange={(event) => setClientEmail(event.target.value)}
                  required
                />
              </label>
              <label className="block text-sm text-zinc-300">
                Budget (USD)
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  className="mt-2 w-full rounded-2xl border border-line bg-ink px-4 py-3 text-sm text-white outline-none ring-lime/40 focus:ring"
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                  required
                />
              </label>
            </div>
            <label className="flex items-start gap-3 text-sm text-zinc-300">
              <input
                type="checkbox"
                className="mt-1"
                checked={pyusdNote}
                onChange={(event) => setPyusdNote(event.target.checked)}
              />
              <span>Note PYUSD as a payment option on invoices. Settlement stays on the PayPal invoice.</span>
            </label>
            {planning ? (
              <ol className="space-y-2 rounded-2xl border border-lime/30 bg-ink/70 p-4" aria-live="polite">
                <li className="font-display text-lg text-white">Grok is planning</li>
                {PLAN_STEPS.map((step, index) => (
                  <li key={step} className={`text-sm ${index === planStep ? "plan-step-active text-lime" : "text-zinc-400"}`}>
                    {index === planStep ? "●" : "○"} {step}
                  </li>
                ))}
              </ol>
            ) : (
              <button
                type="submit"
                className="rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-ink"
              >
                Build milestone plan
              </button>
            )}
          </form>
        </section>
      ) : (
        <section className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_300px] min-[1440px]:grid-cols-[minmax(0,1fr)_340px] min-[1700px]:grid-cols-[minmax(0,1fr)_380px]">
          <div className="plan-column flex min-h-0 flex-col gap-3 overflow-auto lg:overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="font-display text-xl text-white md:text-2xl">{project.name}</h1>
                <p className="project-summary mt-1 line-clamp-1 max-w-3xl text-sm leading-6 text-zinc-300">{project.summary}</p>
              </div>
              <button
                type="button"
                className="rounded-full border border-line px-4 py-2 text-sm text-zinc-300"
                onClick={() => setConfirmNew(true)}
              >
                New plan
              </button>
            </div>

            {money ? (
              <div className="grid shrink-0 grid-cols-4 gap-2" data-testid="money-bar">
                <MoneyCell label="Contract" value={formatMoney(money.contract)} />
                <MoneyCell label="Paid" value={formatMoney(money.paid)} tone="paid" />
                <MoneyCell label="Invoiced" value={formatMoney(money.invoiced)} tone="invoiced" />
                <MoneyCell label="At risk" value={formatMoney(money.atRisk)} tone="overdue" />
              </div>
            ) : null}

            <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
              {project.phases.map((phase, index) => (
                <button
                  key={phase.id}
                  type="button"
                  onClick={() => setSelectedId(phase.id)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${
                    phase.id === selected?.id ? "border-lime text-lime" : "border-line text-zinc-300"
                  }`}
                >
                  {index + 1}. {phase.name}
                  {phase.blocked ? " 🔒" : ""}
                </button>
              ))}
            </div>

            <div className="gantt-block flex min-h-[360px] flex-1 flex-col lg:min-h-0">
              <p className="gantt-caption mb-1 text-[11px] uppercase tracking-[0.16em] text-lime">
                Bryntum Gantt · payment gates are diamonds · padlock means locked until paid
              </p>
              <div className="h-[420px] w-full lg:h-auto lg:min-h-0 lg:flex-1">
                <GanttPanel key={project.id} phases={project.phases} onSelect={setSelectedId} />
              </div>
            </div>

            {selected ? (
              <PhaseCard
                index={project.phases.findIndex((phase) => phase.id === selected.id) + 1}
                phase={selected}
                busy={busy}
                demoPaypal={Boolean(mode?.demoPaypal)}
                clockDate={project.clockDate}
                onInvoice={() => run(() => postJson("/api/phases/invoice", { phase: selected.id }))}
                onSync={() => run(() => postJson("/api/phases/sync", { phase: selected.id }))}
                onPay={() => run(() => postJson("/api/phases/simulate-payment", { phase: selected.id }))}
                onFastForward={() =>
                  run(() => postJson("/api/phases/overdue", { phase: selected.id, simulate: true }))
                }
                onCheck={() => run(() => postJson("/api/phases/overdue", { simulate: false }))}
              />
            ) : null}
          </div>

          <aside className="panel flex min-h-[520px] flex-col overflow-hidden rounded-3xl lg:min-h-0">
            {pendingDrafts.map((draft) => (
              <article key={draft.id} className="shrink-0 border-b border-line px-4 py-3" data-testid="approval-card">
                <p className="text-xs uppercase tracking-[0.16em] text-lime">Approval required</p>
                <h2 className="mt-1 font-display text-lg text-white">{draft.subject}</h2>
                <p className="mt-1 text-xs text-zinc-400">
                  Approve sends this note as a PayPal invoice reminder. Discard sends nothing.
                </p>
                <pre className="mt-2 max-h-[28rem] overflow-auto whitespace-pre-wrap font-sans text-sm leading-5 text-zinc-200">
                  {draft.body}
                </pre>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-full bg-lime px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
                    onClick={() => run(() => postJson("/api/drafts", { draftId: draft.id, action: "approved" }))}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-full border border-line px-4 py-2 text-sm text-zinc-200 disabled:opacity-50"
                    onClick={() => run(() => postJson("/api/drafts", { draftId: draft.id, action: "discarded" }))}
                  >
                    Discard
                  </button>
                </div>
              </article>
            ))}
            <details
              className="shrink-0 border-b border-line"
              open={actionsOpen}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setActionsOpen((current) => (current === open ? current : open));
              }}
            >
              <summary className="cursor-pointer px-4 py-3">
                <span className="font-display text-lg text-white">Agent actions</span>
                <span className="mt-1 block text-xs text-zinc-400">
                  Each tool call, in order, with the PayPal API, status, and latency.
                </span>
              </summary>
              <ol ref={actionsRef} className="max-h-80 space-y-2 overflow-y-auto px-4 pb-3" data-testid="agent-actions">
                {(project.actions ?? []).length === 0 ? (
                  <li className="text-sm text-zinc-500">No tool calls yet. Invoice a phase to start the trail.</li>
                ) : (
                  (project.actions ?? []).map((action) => <ActionRow key={action.id} action={action} />)
                )}
              </ol>
            </details>
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-display text-lg text-white">Agent</h2>
              <p className="text-xs text-zinc-400">Ask what is unpaid, or to invoice or move a phase.</p>
            </div>
            <div ref={chatRef} className="min-h-36 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {project.messages.map((message, index) => (
                <div
                  key={`${message.at}-${index}`}
                  className={`rounded-2xl px-3 py-2 text-sm leading-6 ${
                    message.role === "user" ? "bg-lime/15 text-lime" : "bg-ink text-zinc-100"
                  }`}
                >
                  <RichText text={message.content} />
                </div>
              ))}
            </div>
            <div className="space-y-2 border-t border-line p-3">
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={busy}
                    className="rounded-full border border-line px-3 py-1 text-xs text-zinc-300 disabled:opacity-50"
                    onClick={() => void sendChat(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendChat(chatText);
                }}
              >
                <input
                  className="min-w-0 flex-1 rounded-full border border-line bg-ink px-4 py-2 text-sm text-white outline-none ring-lime/40 focus:ring"
                  placeholder="What's unpaid?"
                  value={chatText}
                  onChange={(event) => setChatText(event.target.value)}
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-full bg-lime px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </div>
          </aside>
        </section>
      )}
      {confirmNew ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4" role="dialog" aria-modal="true" aria-labelledby="confirm-new-title">
          <div className="panel w-full max-w-md rounded-3xl p-6" data-testid="confirm-new-plan">
            <h2 id="confirm-new-title" className="font-display text-2xl text-white">Start a new plan?</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              This clears the milestones in this browser session. Nothing is emailed and no invoice is cancelled.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full bg-lime px-4 py-2 text-sm font-semibold text-ink"
                onClick={() => {
                  setConfirmNew(false);
                  void run(async () => {
                    const response = await fetch("/api/project", { method: "DELETE" });
                    const payload = (await response.json()) as ApiPayload;
                    setSelectedId("");
                    return payload;
                  });
                }}
              >
                Clear plan
              </button>
              <button
                type="button"
                className="rounded-full border border-line px-4 py-2 text-sm text-zinc-200"
                onClick={() => setConfirmNew(false)}
              >
                Keep this plan
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`toast-card rounded-2xl border px-4 py-3 text-sm shadow-card ${
              toast.tone === "err"
                ? "border-red-400/40 bg-red-950/90 text-red-100"
                : "border-lime/40 bg-[#102018]/95 text-lime"
            }`}
          >
            <RichText text={toast.text} />
          </div>
        ))}
      </div>
    </main>
  );
}

function MoneyCell({ label, value, tone }: { label: string; value: string; tone?: PaymentStatus }) {
  const color =
    tone === "paid" ? "text-[#9ff0cb]" : tone === "invoiced" ? "text-[#f3d48a]" : tone === "overdue" ? "text-[#ffb4b4]" : "text-white";
  return (
    <div className="money-card">
      <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">{label}</p>
      <p className={`font-display text-xl ${color}`}>{value}</p>
    </div>
  );
}

function ActionRow({ action }: { action: AgentAction }) {
  return (
    <li className="rounded-xl border border-line bg-ink/70 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-lime">{action.tool}</span>
        <span className={`text-[11px] uppercase ${action.status === "ok" ? "text-[#9ff0cb]" : "text-[#ffb4b4]"}`}>
          {action.status}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-zinc-400">
        {action.paypalApi ?? "Zilla schedule"} · {action.latencyMs < 1 ? "<1 ms" : `${action.latencyMs} ms`}
      </p>
      {action.detail ? <p className="mt-1 truncate text-[11px] text-zinc-500">{action.detail}</p> : null}
    </li>
  );
}

function Legend() {
  const items: PaymentStatus[] = ["draft", "invoiced", "paid", "overdue"];
  return (
    <div className="hidden flex-wrap gap-3 text-zinc-300 xl:flex">
      {items.map((status) => (
        <span key={status} className="inline-flex items-center gap-1.5">
          <i className={`dot dot-${status}`} />
          {STATUS_LABEL[status]}
        </span>
      ))}
    </div>
  );
}

function StatusText({ status }: { status: PaymentStatus }) {
  return (
    <span className={`zilla-pill zilla-pill-${status}`}>
      <i className={`dot dot-${status}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function PhaseCard({
  index,
  phase,
  busy,
  demoPaypal,
  clockDate,
  onInvoice,
  onSync,
  onPay,
  onFastForward,
  onCheck,
}: {
  index: number;
  phase: Project["phases"][number];
  busy: boolean;
  demoPaypal: boolean;
  clockDate?: string | null;
  onInvoice: () => void;
  onSync: () => void;
  onPay: () => void;
  onFastForward: () => void;
  onCheck: () => void;
}) {
  const canInvoice = !phase.blocked && (phase.paymentStatus === "draft" || phase.paymentStatus === "cancelled");
  const canPay =
    Boolean(phase.paypalInvoiceId) &&
    phase.paymentStatus !== "paid" &&
    phase.paymentStatus !== "draft" &&
    phase.paymentStatus !== "cancelled";
  const canForward = phase.paymentStatus === "invoiced" || phase.paymentStatus === "overdue";
  return (
    <div className="phase-card panel shrink-0 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Phase {index}</p>
          <h2 className="font-display text-xl text-white">{phase.name}</h2>
          <p className="phase-description mt-1 line-clamp-1 text-sm text-zinc-300">{phase.description}</p>
        </div>
        <StatusText status={phase.paymentStatus} />
      </div>
      <dl className="mt-2 grid gap-2 text-sm text-zinc-300 sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Amount</dt>
          <dd>{formatMoney(phase.amount)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Schedule</dt>
          <dd>
            {phase.startDate} to {phase.endDate}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">{phase.invoiceDate ? "Due (Net 7)" : "Due"}</dt>
          <dd>{phase.dueDate}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Invoice</dt>
          <dd className="break-all">{phase.paypalInvoiceId ?? "Not sent"}</dd>
        </div>
      </dl>
      {phase.blocked ? (
        <p className="mt-3 text-sm text-amber-200">Locked until the previous phase is paid.</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !canInvoice}
          className="rounded-full bg-lime px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
          onClick={onInvoice}
        >
          Invoice phase
        </button>
        {phase.paypalPayerUrl ? (
          <a
            className="rounded-full border border-lime/40 px-4 py-2 text-sm text-lime"
            href={phase.paypalPayerUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open PayPal invoice
          </a>
        ) : null}
        <button
          type="button"
          disabled={busy || !phase.paypalInvoiceId}
          className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-40"
          onClick={onSync}
        >
          Sync from PayPal
        </button>
      </div>
      {demoPaypal && phase.paypalInvoiceId ? (
        <p className="phase-hint mt-2 text-xs text-zinc-500">Demo mode uses a mock invoice id, so PayPal will not open a payable invoice.</p>
      ) : null}
      <details className="demo-drawer mt-3 rounded-2xl border border-line bg-ink/50 px-3 py-2" data-testid="demo-controls">
        <summary className="text-sm text-zinc-300">Demo controls</summary>
        <p className="demo-hint mt-2 text-xs text-zinc-500">
          {clockDate
            ? `Demo clock is ${clockDate}. Fast-forward moves it 7 days past the Net-7 due date. It does not backdate the invoice.`
            : "The clock follows America/Los_Angeles until you fast-forward. Simulate stays off the main path."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !canPay}
            className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-40"
            onClick={onPay}
          >
            Simulate payment
          </button>
          <button
            type="button"
            disabled={busy || !canForward}
            className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-40"
            onClick={onFastForward}
          >
            Fast-forward past due
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-40"
            onClick={onCheck}
          >
            Check overdue
          </button>
        </div>
      </details>
    </div>
  );
}
