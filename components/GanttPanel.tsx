"use client";

import { useEffect, useRef, useState } from "react";
import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/stockholm-dark.css";
import { addDays } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/status";
import type { PaymentStatus, Phase } from "@/lib/types";

interface GanttLike {
  destroy: () => void;
  project: { loadInlineData: (data: object) => Promise<void> };
  setTimeSpan?: (start: Date, end: Date) => void;
}

interface BryntumModule {
  Gantt: new (config: Record<string, unknown>) => GanttLike;
  TaskModel: abstract new (...args: never[]) => {
    name: string;
    get: (field: string) => unknown;
  };
}

function encode(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function chartData(projectName: string, phases: Phase[]) {
  return {
    calendarsData: [
      {
        id: "alldays",
        name: "All days",
        unspecifiedTimeIsWorking: true,
        intervals: [],
      },
    ],
    tasksData: [
      {
        id: "project-root",
        name: projectName,
        expanded: true,
        manuallyScheduled: true,
        calendar: "alldays",
        children: phases.map((phase) => ({
          id: phase.id,
          name: phase.name,
          startDate: phase.startDate,
          duration: phase.durationDays,
          durationUnit: "day",
          manuallyScheduled: true,
          calendar: "alldays",
          paymentStatus: phase.paymentStatus,
          amount: phase.amount,
          phaseId: phase.id,
          blocked: phase.blocked,
          zillaStart: phase.startDate,
          zillaEnd: phase.endDate,
          cls: `zilla-bar zilla-${phase.paymentStatus}`,
        })),
      },
    ],
    dependenciesData: phases.flatMap((phase) =>
      phase.dependencies.map((dependencyId) => ({
        id: `${dependencyId}-${phase.id}`,
        fromTask: dependencyId,
        toTask: phase.id,
      })),
    ),
  };
}

function addClass(target: unknown, className: string) {
  if (!target) return;
  if (typeof (target as { add?: (value: string) => void }).add === "function") {
    (target as { add: (value: string) => void }).add(className);
  }
}

export function GanttPanel({
  projectName,
  phases,
  onSelect,
}: {
  projectName: string;
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
      phase.dependencies.join(","),
    ]),
  );

  useEffect(() => {
    let dead = false;
    let chart: GanttLike | null = null;
    const host = hostRef.current;

    async function boot() {
      try {
        const mod = (await import("@bryntum/gantt")) as unknown as BryntumModule;
        if (dead || !host) return;
        class PhaseTask extends mod.TaskModel {
          static get fields() {
            return [
              { name: "paymentStatus", type: "string" },
              { name: "amount", type: "number" },
              { name: "phaseId", type: "string" },
              { name: "zillaStart", type: "string" },
              { name: "zillaEnd", type: "string" },
              { name: "blocked", type: "boolean" },
            ];
          }
        }
        chart = new mod.Gantt({
          appendTo: host,
          startDate: phasesRef.current[0]?.startDate,
          rowHeight: 52,
          barMargin: 10,
          viewPreset: "weekAndDayLetter",
          project: {
            taskModelClass: PhaseTask,
            autoSetConstraints: false,
            calendar: "alldays",
            hoursPerDay: 24,
            daysPerWeek: 7,
            daysPerMonth: 30,
          },
          columns: [
            { type: "name", text: "Milestone", width: 220 },
            { field: "zillaStart", text: "Start", width: 110 },
            { field: "zillaEnd", text: "Finish", width: 110 },
            {
              field: "amount",
              text: "Amount",
              width: 110,
              renderer: ({ value }: { value: unknown }) =>
                typeof value === "number" ? formatMoney(value) : "",
            },
            {
              field: "paymentStatus",
              text: "Payment",
              width: 130,
              htmlEncode: false,
              renderer: ({ value }: { value: unknown }) => {
                const status = (typeof value === "string" ? value : "draft") as PaymentStatus;
                const label = STATUS_LABEL[status] ?? "Draft";
                return `<span class="zilla-pill zilla-pill-${encode(status)}">${encode(label)}</span>`;
              },
            },
          ],
          features: {
            taskDrag: false,
            taskResize: false,
            taskDragCreate: false,
            taskEdit: false,
            taskMenu: false,
            cellEdit: false,
            dependencies: true,
            dependencyEdit: false,
            percentBar: false,
            baselines: false,
            progressLine: false,
            projectLines: false,
            taskTooltip: {
              template: ({ taskRecord }: { taskRecord: { name?: string; get: (field: string) => unknown } }) => {
                const status = String(taskRecord.get("paymentStatus") || "draft") as PaymentStatus;
                const amount = taskRecord.get("amount");
                const money = typeof amount === "number" ? formatMoney(amount) : "";
                return `<div><strong>${encode(taskRecord.name || "")}</strong><div>${encode(STATUS_LABEL[status] ?? status)} ${encode(money)}</div></div>`;
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
            renderData: { cls?: unknown; wrapperCls?: unknown };
          }) => {
            const status = String(taskRecord.get("paymentStatus") || "draft");
            addClass(renderData?.cls, `zilla-${status}`);
            addClass(renderData?.wrapperCls, `zilla-${status}`);
            return "";
          },
        });
        chartRef.current = chart;
        await chart.project.loadInlineData(chartData(projectName, phasesRef.current));
        frame(chart, phasesRef.current);
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
      chart?.destroy();
      chartRef.current = null;
      setReady(false);
      if (host) host.innerHTML = "";
    };
    // Boot once per mount. Project swaps remount the panel via key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;
    void chart.project.loadInlineData(chartData(projectName, phases)).then(() => {
      frame(chart, phases);
    });
  }, [dataKey, phases, projectName, ready]);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-[#0c1612]">
      {error ? (
        <div className="p-6 text-sm text-red-200">{error}</div>
      ) : (
        <div ref={hostRef} className="zilla-gantt" />
      )}
    </div>
  );
}

function frame(chart: GanttLike, phases: Phase[]) {
  if (!chart.setTimeSpan || phases.length === 0) return;
  const start = phases.map((phase) => phase.startDate).sort()[0];
  const end = phases.map((phase) => phase.endDate).sort().at(-1);
  if (!start || !end) return;
  chart.setTimeSpan(new Date(`${addDays(start, -3)}T00:00:00`), new Date(`${addDays(end, 14)}T00:00:00`));
}
