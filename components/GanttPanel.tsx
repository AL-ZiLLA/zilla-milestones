"use client";

import { useEffect, useRef, useState } from "react";
import "@bryntum/core-community/fontawesome/css/fontawesome.css";
import "@bryntum/core-community/fontawesome/css/solid.css";
import "@bryntum/gantt-community/gantt.css";
import "@bryntum/gantt-community/stockholm-dark.css";
import { daysBetween, formatGanttDate, formatShortDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { paymentProgress, STATUS_LABEL } from "@/lib/status";
import { timelineHeader, timelineRange, timelineTickSize } from "@/lib/timeline";
import type { PaymentStatus, Phase } from "@/lib/types";

interface GanttLike {
  destroy: () => void;
  project: { loadInlineData: (data: object) => Promise<void> };
  setTimeSpan?: (start: Date, end: Date) => void;
  tickSize?: number;
  rowHeight?: number;
  viewPreset?: unknown;
  columns?: { getAt: (index: number) => { width: number; minWidth?: number } | undefined };
  subGrids?: { locked?: { width: number } };
  _zillaHeader?: string;
  _zillaFitRange?: string;
  _zillaFitWidth?: number;
  _zillaFitTick?: number;
}

interface BryntumModule {
  Gantt: new (config: Record<string, unknown>) => GanttLike;
  TaskModel: abstract new (...args: never[]) => {
    name: string;
    get: (field: string) => unknown;
  };
}

const LOCK_ICON = `<svg class="zilla-lock-icon" viewBox="0 0 24 24" aria-label="Locked until paid"><path fill="currentColor" d="M8 10V8a4 4 0 1 1 8 0v2h1.2A1.8 1.8 0 0 1 19 11.8v7.4A1.8 1.8 0 0 1 17.2 21H6.8A1.8 1.8 0 0 1 5 19.2v-7.4A1.8 1.8 0 0 1 6.8 10H8zm2 0h4V8a2 2 0 1 0-4 0v2z"/></svg>`;
const OPEN_ICON = `<svg class="zilla-lock-icon is-open" viewBox="0 0 24 24" aria-label="Unlocked"><path fill="currentColor" d="M8 10V8a4 4 0 0 1 7.5-2h-2.1A2 2 0 0 0 10 8v2H6.8A1.8 1.8 0 0 0 5 11.8v7.4A1.8 1.8 0 0 0 6.8 21h10.4a1.8 1.8 0 0 0 1.8-1.8v-7.4a1.8 1.8 0 0 0-1.8-1.8H8zm4 3.2a1.4 1.4 0 0 1 .7 2.6V19h-1.4v-3.2a1.4 1.4 0 0 1 .7-2.6z"/></svg>`;

function encode(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function columnLayout(width: number): {
  name: number;
  date: number;
  amount: number;
  payment: number;
  gate: number;
  locked: number;
} {
  if (width >= 1350) {
    return { name: 220, date: 108, amount: 112, payment: 96, gate: 60, locked: 220 + 108 + 108 + 112 + 96 + 60 };
  }
  if (width >= 1050) {
    return { name: 210, date: 100, amount: 108, payment: 92, gate: 56, locked: 210 + 100 + 100 + 108 + 92 + 56 };
  }
  return { name: 204, date: 90, amount: 112, payment: 92, gate: 52, locked: 204 + 90 + 90 + 112 + 92 + 52 };
}

function planStartYear(phases: Phase[]): number {
  const first = phases.map((phase) => phase.startDate).sort()[0];
  const year = Number(first?.slice(0, 4));
  return Number.isFinite(year) ? year : 1970;
}

function dateFields(isoDate: string, startYear: number): { label: string; full: string } {
  return { label: formatGanttDate(isoDate, startYear), full: formatShortDate(isoDate) };
}

function chartData(phases: Phase[]) {
  const startYear = planStartYear(phases);
  const gates = phases.flatMap((phase) =>
    phases
      .filter((successor) => successor.dependencies.includes(phase.id))
      .map((successor) => ({
        id: `gate-${phase.id}-${successor.id}`,
        from: phase.id,
        to: successor.id,
        startDate: phase.endDate,
        open: phase.paymentStatus === "paid",
      })),
  );
  const gateAfter = new Map<string, typeof gates>();
  for (const gate of gates) {
    const list = gateAfter.get(gate.from) ?? [];
    list.push(gate);
    gateAfter.set(gate.from, list);
  }

  const tasks = phases.flatMap((phase) => {
    const progress = paymentProgress(phase.paymentStatus);
    const phaseTask = {
      id: phase.id,
      name: phase.name,
      startDate: phase.startDate,
      endDate: phase.endDate,
      duration: phase.durationDays,
      durationUnit: "day",
      manuallyScheduled: true,
      calendar: "alldays",
      percentDone: progress,
      paymentStatus: phase.paymentStatus,
      amount: phase.amount,
      phaseId: phase.id,
      blocked: phase.blocked,
      isGate: false,
      gateState: phase.blocked ? "locked" : "open",
      zillaStart: dateFields(phase.startDate, startYear).label,
      zillaEnd: dateFields(phase.endDate, startYear).label,
      zillaStartFull: dateFields(phase.startDate, startYear).full,
      zillaEndFull: dateFields(phase.endDate, startYear).full,
      cls: `zilla-bar zilla-${phase.paymentStatus}${phase.blocked ? " zilla-locked" : ""}`,
    };
    const diamonds = (gateAfter.get(phase.id) ?? []).map((gate) => ({
      id: gate.id,
      name: "Payment gate",
      startDate: gate.startDate,
      endDate: gate.startDate,
      duration: 0,
      durationUnit: "day",
      manuallyScheduled: true,
      calendar: "alldays",
      percentDone: gate.open ? 100 : 0,
      paymentStatus: gate.open ? "paid" : "overdue",
      amount: null,
      phaseId: phase.id,
      blocked: !gate.open,
      isGate: true,
      gateState: gate.open ? "gate-open" : "gate-locked",
      zillaStart: dateFields(gate.startDate, startYear).label,
      zillaEnd: dateFields(gate.startDate, startYear).label,
      zillaStartFull: dateFields(gate.startDate, startYear).full,
      zillaEndFull: dateFields(gate.startDate, startYear).full,
      cls: `zilla-gate ${gate.open ? "zilla-gate-open" : "zilla-gate-locked"}`,
    }));
    return [phaseTask, ...diamonds];
  });

  const dependencies = phases.flatMap((phase) =>
    phase.dependencies.flatMap((dependencyId) => {
      const gate = gates.find((item) => item.from === dependencyId && item.to === phase.id);
      const locked = phase.blocked;
      const cls = locked ? "zilla-dep-locked" : "zilla-dep-open";
      if (!gate) {
        return [{ id: `${dependencyId}-${phase.id}`, fromTask: dependencyId, toTask: phase.id, cls }];
      }
      return [
        { id: `${dependencyId}-${gate.id}`, fromTask: dependencyId, toTask: gate.id, cls },
        { id: `${gate.id}-${phase.id}`, fromTask: gate.id, toTask: phase.id, cls },
      ];
    }),
  );

  return {
    calendarsData: [
      {
        id: "alldays",
        name: "All days",
        unspecifiedTimeIsWorking: true,
        intervals: [],
      },
    ],
    tasksData: tasks,
    dependenciesData: dependencies,
  };
}

function fitRowHeight(hostHeight: number, rowCount: number): number {
  const header = 64;
  const room = hostHeight - header;
  if (room <= 0 || rowCount <= 0) return 40;
  return Math.max(30, Math.min(44, Math.floor(room / rowCount)));
}

function dateCell(
  record: { get: (field: string) => unknown },
  labelField: string,
  fullField: string,
): string {
  const label = String(record.get(labelField) || "");
  const full = String(record.get(fullField) || label);
  return `<span title="${encode(full)}">${encode(label)}</span>`;
}

function addClass(target: unknown, className: string) {
  if (!target) return;
  if (typeof (target as { add?: (value: string) => void }).add === "function") {
    (target as { add: (value: string) => void }).add(className);
  }
}

function frame(chart: GanttLike, phases: Phase[], host: HTMLElement) {
  if (!chart.setTimeSpan || phases.length === 0) return;
  const layout = columnLayout(host.clientWidth || window.innerWidth);
  const widths = [layout.name, layout.date, layout.date, layout.amount, layout.payment, layout.gate];
  widths.forEach((width, index) => {
    const column = chart.columns?.getAt(index);
    if (column) {
      column.width = width;
      column.minWidth = width;
    }
  });
  if (chart.subGrids?.locked) chart.subGrids.locked.width = layout.locked;
  const rowCount = phases.length + phases.reduce((count, phase) => count + phase.dependencies.length, 0);
  chart.rowHeight = fitRowHeight(host.clientHeight, rowCount);
  const start = phases.map((phase) => phase.startDate).sort()[0];
  const end = phases.map((phase) => phase.endDate).sort().at(-1);
  if (!start || !end) return;
  const { startDate, endDate } = timelineRange(start, end);
  const axis = host.querySelector(".b-grid-sub-grid-normal");
  const measured = axis?.clientWidth ?? 0;
  const available = measured > 0 ? measured : Math.max(140, host.clientWidth - layout.locked - 8);
  const timeline = Math.max(80, available - 16);
  const rangeKey = `${startDate}|${endDate}`;
  let tick = timelineTickSize(timeline, daysBetween(startDate, endDate));
  const sameRange = chart._zillaFitRange === rangeKey && chart._zillaFitTick;
  const widthGrew = timeline > (chart._zillaFitWidth ?? 0) + 24;
  if (sameRange && !widthGrew) tick = Math.min(tick, chart._zillaFitTick ?? tick);
  applySpan(chart, tick, startDate, endDate);
  chart._zillaFitRange = rangeKey;
  chart._zillaFitWidth = timeline;
  chart._zillaFitTick = tick;
  tightenSpan(chart, host, startDate, endDate, rangeKey, 0);
}

function tightenSpan(
  chart: GanttLike,
  host: HTMLElement,
  startDate: string,
  endDate: string,
  rangeKey: string,
  attempt: number,
) {
  requestAnimationFrame(() => {
    if (chart._zillaFitRange !== rangeKey || attempt > 6) return;
    if (!axisOverflows(host)) return;
    const current = chart._zillaFitTick ?? 1;
    const next = Math.max(1, Math.floor(current * 0.9));
    if (next === current) return;
    chart._zillaFitTick = next;
    applySpan(chart, next, startDate, endDate);
    tightenSpan(chart, host, startDate, endDate, rangeKey, attempt + 1);
  });
}

function applySpan(chart: GanttLike, tick: number, startDate: string, endDate: string) {
  const header = timelineHeader(tick);
  if (chart._zillaHeader !== header.id) {
    chart.viewPreset = header;
    chart._zillaHeader = header.id;
  }
  chart.setTimeSpan?.(new Date(`${startDate}T00:00:00`), new Date(`${endDate}T00:00:00`));
  chart.tickSize = tick;
}

function axisOverflows(host: HTMLElement): boolean {
  const axis = host.querySelector(".b-grid-sub-grid-normal");
  if (!axis) return false;
  const edge = axis.getBoundingClientRect().right - 1;
  const past = (node: Element) => node.getBoundingClientRect().right > edge;
  const bars = [...host.querySelectorAll(".b-gantt-task, .b-sch-event, .b-gantt-task-wrap")].some(past);
  const headers = [...host.querySelectorAll(".b-grid-header-scroller-normal .b-sch-header-time-axis-cell")].some(past);
  return bars || headers;
}

export function GanttPanel({
  phases,
  onSelect,
}: {
  phases: Phase[];
  onSelect: (phaseId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<GanttLike | null>(null);
  const onSelectRef = useRef(onSelect);
  const phasesRef = useRef(phases);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  onSelectRef.current = onSelect;
  phasesRef.current = phases;

  const dataKey = JSON.stringify(
    phases.map((phase) => [
      phase.id,
      phase.name,
      phase.startDate,
      phase.endDate,
      phase.durationDays,
      phase.paymentStatus,
      phase.amount,
      phase.blocked,
      phase.dependencies.join(","),
    ]),
  );

  useEffect(() => {
    let dead = false;
    let chart: GanttLike | null = null;
    const host = hostRef.current;
    const observer = new ResizeObserver(() => {
      if (chart && host) frame(chart, phasesRef.current, host);
    });

    async function boot() {
      try {
        const mod = (await import("@bryntum/gantt-community")) as unknown as BryntumModule;
        if (dead || !host) return;
        const layout = columnLayout(host.clientWidth || window.innerWidth);
        class PhaseTask extends mod.TaskModel {
          static get fields() {
            return [
              { name: "paymentStatus", type: "string" },
              { name: "amount", type: "number" },
              { name: "phaseId", type: "string" },
              { name: "zillaStart", type: "string" },
              { name: "zillaEnd", type: "string" },
              { name: "zillaStartFull", type: "string" },
              { name: "zillaEndFull", type: "string" },
              { name: "blocked", type: "boolean" },
              { name: "isGate", type: "boolean" },
              { name: "gateState", type: "string" },
            ];
          }
        }
        chart = new mod.Gantt({
          appendTo: host,
          forceFit: true,
          rowHeight: 40,
          barMargin: 6,
          viewPreset: timelineHeader(120),
          subGridConfigs: {
            locked: { width: layout.locked },
          },
          project: {
            taskModelClass: PhaseTask,
            autoSetConstraints: false,
            calendar: "alldays",
            hoursPerDay: 24,
            daysPerWeek: 7,
            daysPerMonth: 30,
          },
          columns: [
            { type: "name", text: "Milestone", tooltip: "Milestone", width: layout.name, minWidth: layout.name },
            {
              field: "zillaStart",
              text: "Start",
              width: layout.date,
              minWidth: layout.date,
              htmlEncode: false,
              renderer: ({ record }: { record: { get: (field: string) => unknown } }) => dateCell(record, "zillaStart", "zillaStartFull"),
            },
            {
              field: "zillaEnd",
              text: "Finish",
              width: layout.date,
              minWidth: layout.date,
              htmlEncode: false,
              renderer: ({ record }: { record: { get: (field: string) => unknown } }) => dateCell(record, "zillaEnd", "zillaEndFull"),
            },
            {
              field: "amount",
              text: "Amount",
              width: layout.amount,
              renderer: ({ value, record }: { value: unknown; record: { get: (field: string) => unknown } }) =>
                record.get("isGate") || typeof value !== "number" ? "" : formatMoney(value),
            },
            {
              field: "paymentStatus",
              text: "Pay",
              tooltip: "Payment",
              width: layout.payment,
              htmlEncode: false,
              renderer: ({ record }: { record: { get: (field: string) => unknown } }) => {
                if (record.get("isGate")) return `<span class="zilla-pill zilla-pill-draft">Gate</span>`;
                const status = String(record.get("paymentStatus") || "draft") as PaymentStatus;
                const label = STATUS_LABEL[status] ?? "Draft";
                return `<span class="zilla-pill zilla-pill-${encode(status)}">${encode(label)}</span>`;
              },
            },
            {
              field: "gateState",
              text: "Gate",
              tooltip: "Payment gate",
              width: layout.gate,
              align: "center",
              htmlEncode: false,
              renderer: ({ value }: { value: unknown }) => {
                const state = String(value || "");
                if (state === "locked" || state === "gate-locked") return LOCK_ICON;
                if (state === "open" || state === "gate-open") return OPEN_ICON;
                return "";
              },
            },
          ],
          features: {
            taskDrag: false,
            taskResize: false,
            taskDragCreate: false,
            taskMenu: false,
            cellEdit: false,
            dependencies: true,
            taskTooltip: {
              template: ({ taskRecord }: { taskRecord: { name?: string; get: (field: string) => unknown } }) => {
                if (taskRecord.get("isGate")) {
                  const open = taskRecord.get("gateState") === "gate-open";
                  return `<div><strong>Payment gate</strong><div>${open ? "Paid — next phase is open" : "Locked until this phase is paid"}</div></div>`;
                }
                const status = String(taskRecord.get("paymentStatus") || "draft") as PaymentStatus;
                const amount = taskRecord.get("amount");
                const money = typeof amount === "number" ? formatMoney(amount) : "";
                const lock = taskRecord.get("blocked") ? " · Locked" : "";
                return `<div><strong>${encode(taskRecord.name || "")}</strong><div>${encode(STATUS_LABEL[status] ?? status)} ${encode(money)}${encode(lock)}</div></div>`;
              },
            },
          },
          listeners: {
            taskClick: ({ taskRecord }: { taskRecord: { get: (field: string) => unknown } }) => {
              const phaseId = taskRecord.get("phaseId");
              if (typeof phaseId === "string") onSelectRef.current(phaseId);
            },
          },
          taskRenderer: ({
            taskRecord,
            renderData,
          }: {
            taskRecord: { get: (field: string) => unknown };
            renderData: { cls?: unknown; wrapperCls?: unknown; style?: Record<string, string> };
          }) => {
            const status = String(taskRecord.get("paymentStatus") || "draft");
            const progress = Number(taskRecord.get("percentDone") || 0);
            if (renderData) {
              renderData.style = { ...(renderData.style ?? {}), "--zilla-progress": `${progress}%` };
            }
            addClass(renderData?.cls, `zilla-${status}`);
            addClass(renderData?.wrapperCls, `zilla-${status}`);
            if (taskRecord.get("isGate")) {
              addClass(renderData?.cls, String(taskRecord.get("gateState")) === "gate-open" ? "zilla-gate-open" : "zilla-gate-locked");
              return "";
            }
            if (taskRecord.get("blocked")) {
              addClass(renderData?.cls, "zilla-locked");
              return LOCK_ICON;
            }
            return "";
          },
        });
        chartRef.current = chart;
        await chart.project.loadInlineData(chartData(phasesRef.current));
        frame(chart, phasesRef.current, host);
        observer.observe(host);
        if (!dead) setReady(true);
      } catch (bootError) {
        if (!dead) {
          setError(bootError instanceof Error ? bootError.message : "Bryntum Gantt failed to start");
        }
      }
    }

    void boot();
    return () => {
      dead = true;
      observer.disconnect();
      chart?.destroy();
      chartRef.current = null;
      setReady(false);
      if (host) host.innerHTML = "";
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const host = hostRef.current;
    if (!chart || !ready || !host) return;
    void chart.project.loadInlineData(chartData(phases)).then(() => {
      frame(chart, phases, host);
    });
  }, [dataKey, phases, ready]);

  return (
    <div className="h-full overflow-hidden rounded-2xl border border-line bg-[#0c1612]" data-testid="gantt">
      {error ? <div className="p-6 text-sm text-red-200">{error}</div> : <div ref={hostRef} className="zilla-gantt" />}
    </div>
  );
}
