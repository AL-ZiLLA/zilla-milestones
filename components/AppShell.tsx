"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { GanttPanel } from "@/components/GanttPanel";
import { SAMPLE_SCOPE } from "@/lib/demo-plan";
import { formatMoney } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/status";
import type { PaymentStatus, Project, RuntimeMode } from "@/lib/types";

interface ApiPayload {
  project: Project | null;
  mode: RuntimeMode;
  message?: string;
  error?: string;
}

const SUGGESTIONS = ["What's unpaid?", "Invoice phase 1", "Push design back a week"];

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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [scope, setScope] = useState(SAMPLE_SCOPE);
  const [clientEmail, setClientEmail] = useState("billing@example.com");
  const [budget, setBudget] = useState("12000");
  const [pyusdNote, setPyusdNote] = useState(true);
  const [chatText, setChatText] = useState("");

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
        if (!dead) setError(loadError instanceof Error ? loadError.message : "Could not load the plan");
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

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

  async function run(task: () => Promise<ApiPayload>) {
    setBusy(true);
    setError(null);
    try {
      const payload = await task();
      setProject(payload.project);
      if (payload.mode) setMode(payload.mode);
      setNotice(payload.message ?? null);
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function createPlan(event: FormEvent) {
    event.preventDefault();
    const amount = Number(budget);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a budget greater than zero.");
      return;
    }
    await run(() =>
      postJson("/api/project", {
        scope,
        clientEmail,
        budget: amount,
        pyusdNote,
      }),
    );
  }

  async function sendChat(text: string) {
    const message = text.trim();
    if (!message) return;
    setChatText("");
    await run(() => postJson("/api/chat", { message }));
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center text-sm text-zinc-300">
        Loading Zilla Milestones
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[1440px] flex-col px-4 py-5 md:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-lime text-ink">
            <span className="font-display text-2xl font-bold">Z</span>
          </div>
          <div>
            <p className="font-display text-2xl font-semibold tracking-tight text-white">
              Zilla Milestones
            </p>
            <p className="text-sm text-zinc-400">by Zilla Labs</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {mode ? (
            <span className="rounded-full border border-line px-3 py-1 text-lime">{modeLabel(mode)}</span>
          ) : null}
          <Legend />
        </div>
      </header>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-400/40 bg-red-950/40 px-4 py-3 text-sm text-red-100" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 rounded-xl border border-lime/30 bg-lime/10 px-4 py-3 text-sm text-lime" role="status">
          {notice}
        </p>
      ) : null}

      {!project ? (
        <section className="panel mx-auto w-full max-w-3xl rounded-3xl p-6 md:p-8">
          <h1 className="font-display text-3xl text-white">Turn a scope into paid milestones</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
            Paste the work, a billing email, and a budget. The agent splits it into phases, the Bryntum Gantt
            shows payment status, and PayPal sandbox invoices unlock the next bar when they are paid.
          </p>
          <form className="mt-6 space-y-4" onSubmit={createPlan}>
            <label className="block text-sm text-zinc-300">
              Project scope
              <textarea
                className="mt-2 h-48 w-full rounded-2xl border border-line bg-ink px-4 py-3 text-sm text-white outline-none ring-lime/40 focus:ring"
                value={scope}
                onChange={(event) => setScope(event.target.value)}
                required
              />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
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
              <span>
                Note PYUSD as a payment option on invoices. This adds a PayPal USD note for wallets that support it.
                Settlement stays on the PayPal invoice.
              </span>
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={busy}
                className="rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
              >
                {busy ? "Planning..." : "Build milestone plan"}
              </button>
              <button
                type="button"
                className="rounded-full border border-line px-5 py-2.5 text-sm text-zinc-200"
                onClick={() => {
                  setScope(SAMPLE_SCOPE);
                  setClientEmail("billing@example.com");
                  setBudget("12000");
                }}
              >
                Use sample scope
              </button>
            </div>
          </form>
        </section>
      ) : (
        <section className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="font-display text-3xl text-white">{project.name}</h1>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-300">{project.summary}</p>
                <p className="mt-2 text-xs uppercase tracking-[0.14em] text-zinc-500">
                  {formatMoney(project.budget)} · {project.clientEmail}
                  {project.pyusdNote ? " · PYUSD note on invoices" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-full border border-line px-4 py-2 text-sm text-zinc-100 disabled:opacity-50"
                  onClick={() => run(() => postJson("/api/phases/sync", {}))}
                >
                  Sync status
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-full border border-line px-4 py-2 text-sm text-zinc-100 disabled:opacity-50"
                  onClick={() => run(() => postJson("/api/phases/overdue", { simulate: false }))}
                >
                  Check overdue
                </button>
                <button
                  type="button"
                  className="rounded-full border border-line px-4 py-2 text-sm text-zinc-400"
                  onClick={() => {
                    if (!window.confirm("Clear this plan and start over?")) return;
                    void run(async () => {
                      const response = await fetch("/api/project", { method: "DELETE" });
                      return (await response.json()) as ApiPayload;
                    });
                  }}
                >
                  New plan
                </button>
              </div>
            </div>

            <p className="mb-2 text-xs uppercase tracking-[0.16em] text-lime">Bryntum Gantt</p>
            <GanttPanel
              key={project.id}
              projectName={project.name}
              phases={project.phases}
              onSelect={setSelectedId}
            />

            {selected ? (
              <PhaseCard
                index={project.phases.findIndex((phase) => phase.id === selected.id) + 1}
                phase={selected}
                busy={busy}
                onInvoice={() => run(() => postJson("/api/phases/invoice", { phase: selected.id }))}
                onSync={() => run(() => postJson("/api/phases/sync", { phase: selected.id }))}
                onPay={() => run(() => postJson("/api/phases/simulate-payment", { phase: selected.id }))}
                onOverdue={() =>
                  run(() => postJson("/api/phases/overdue", { phase: selected.id, simulate: true }))
                }
              />
            ) : null}

            <ol className="grid gap-2 md:hidden">
              {project.phases.map((phase, index) => (
                <li key={phase.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(phase.id)}
                    className="flex w-full items-center justify-between rounded-2xl border border-line bg-panel px-4 py-3 text-left text-sm"
                  >
                    <span>
                      {index + 1}. {phase.name}
                    </span>
                    <StatusText status={phase.paymentStatus} />
                  </button>
                </li>
              ))}
            </ol>

            {pendingDrafts.length > 0 ? (
              <div className="space-y-3">
                <h2 className="font-display text-xl text-white">Client updates awaiting approval</h2>
                <p className="text-sm text-zinc-400">
                  These drafts are never sent automatically. Approve keeps a copy here. Discard throws it away.
                </p>
                {pendingDrafts.map((draft) => (
                  <article key={draft.id} className="panel rounded-2xl p-4">
                    <h3 className="text-sm font-semibold text-white">{draft.subject}</h3>
                    <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-zinc-300">
                      {draft.body}
                    </pre>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-full bg-lime px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
                        onClick={() =>
                          run(async () => {
                            await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
                            return postJson("/api/drafts", { draftId: draft.id, action: "approved" });
                          })
                        }
                      >
                        Approve and copy
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
              </div>
            ) : null}
          </div>

          <aside className="panel flex h-[calc(100vh-8rem)] min-h-[640px] flex-col rounded-3xl">
            <div className="border-b border-line px-4 py-4">
              <h2 className="font-display text-xl text-white">Agent</h2>
              <p className="text-xs text-zinc-400">Ask it to invoice, shift, or explain what is unpaid.</p>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {project.messages.map((message, index) => (
                <p
                  key={`${message.at}-${index}`}
                  className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-6 ${
                    message.role === "user" ? "bg-lime/15 text-lime" : "bg-ink text-zinc-100"
                  }`}
                >
                  {message.content}
                </p>
              ))}
            </div>
            <div className="space-y-2 border-t border-line p-4">
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
                  placeholder="Invoice phase 2"
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
    </main>
  );
}

function Legend() {
  const items: PaymentStatus[] = ["draft", "invoiced", "paid", "overdue"];
  return (
    <div className="flex flex-wrap gap-3 text-zinc-300">
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
  onInvoice,
  onSync,
  onPay,
  onOverdue,
}: {
  index: number;
  phase: Project["phases"][number];
  busy: boolean;
  onInvoice: () => void;
  onSync: () => void;
  onPay: () => void;
  onOverdue: () => void;
}) {
  const canInvoice = !phase.blocked && (phase.paymentStatus === "draft" || phase.paymentStatus === "cancelled");
  const canPay = Boolean(phase.paypalInvoiceId) && phase.paymentStatus !== "paid" && phase.paymentStatus !== "draft" && phase.paymentStatus !== "cancelled";
  const canOverdue = phase.paymentStatus === "invoiced" || phase.paymentStatus === "overdue";
  return (
    <div className="panel rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Phase {index}</p>
          <h2 className="font-display text-2xl text-white">{phase.name}</h2>
          <p className="mt-1 text-sm text-zinc-300">{phase.description}</p>
        </div>
        <StatusText status={phase.paymentStatus} />
      </div>
      <dl className="mt-4 grid gap-3 text-sm text-zinc-300 sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Amount</dt>
          <dd>{formatMoney(phase.amount)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Dates</dt>
          <dd>
            {phase.startDate} to {phase.endDate}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Due</dt>
          <dd>{phase.dueDate}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Invoice</dt>
          <dd className="break-all">{phase.paypalInvoiceId ?? "Not sent"}</dd>
        </div>
      </dl>
      {phase.blocked ? (
        <p className="mt-3 text-sm text-amber-200">Blocked until the previous milestone is paid.</p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !canInvoice}
          className="rounded-full bg-lime px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
          onClick={onInvoice}
        >
          Invoice phase
        </button>
        <button
          type="button"
          disabled={busy || !phase.paypalInvoiceId}
          className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-40"
          onClick={onSync}
        >
          Sync status
        </button>
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
          disabled={busy || !canOverdue}
          className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-40"
          onClick={onOverdue}
        >
          Simulate overdue
        </button>
      </div>
    </div>
  );
}
