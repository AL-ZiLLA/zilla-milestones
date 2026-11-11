import type { Plan } from "@/lib/schema";

const PHASES: Plan["phases"] = [
  {
    name: "Discovery",
    description: "Workshop the scope, confirm the sitemap, and write the milestone brief.",
    durationDays: 5,
    amount: 20,
    dependsOn: [],
  },
  {
    name: "Design",
    description: "Visual design for the primary screens, including review and revisions.",
    durationDays: 8,
    amount: 25,
    dependsOn: ["Discovery"],
  },
  {
    name: "Build",
    description: "Implement the approved design, wire up content, and complete internal QA.",
    durationDays: 12,
    amount: 40,
    dependsOn: ["Design"],
  },
  {
    name: "Launch",
    description: "Release checklist, handoff notes, and a short support window.",
    durationDays: 5,
    amount: 15,
    dependsOn: ["Build"],
  },
];

export function cannedPlan(scope: string): Plan {
  const firstLine = scope
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const projectName =
    firstLine && firstLine.length <= 72 ? firstLine.replace(/[.]+$/, "") : "Milestone plan";

  return {
    projectName,
    summary:
      "Four payment-gated milestones: Discovery, Design, Build, and Launch. Each later phase waits until the previous invoice is paid.",
    phases: PHASES.map((phase) => ({ ...phase, dependsOn: [...phase.dependsOn] })),
  };
}

export const HVAC_SCOPE = `HVAC booking portal

Scope:
- Discovery workshop, sitemap, and milestone brief
- Visual design for booking, scheduling, and customer screens
- Build the portal, including the booking flow and internal QA
- Launch checklist, handoff, and a short support window

Sequence design after discovery, build after design, and launch after build.`;

export const HARBOR_SCOPE = `Harbor & Pine commerce site

Scope:
- Discovery workshop and sitemap
- Visual design for home, catalog, and checkout
- Storefront build with a product grid and cart
- Launch checklist, QA, and handoff

Sequence design after discovery, build after design, and launch after build.`;

export const SAMPLE_SCOPE = HVAC_SCOPE;

export const SAMPLE_SCOPES = [
  {
    id: "hvac",
    title: "HVAC booking portal",
    budget: "18000",
    email: "billing@example.com",
    scope: HVAC_SCOPE,
  },
  {
    id: "harbor",
    title: "Harbor & Pine commerce site",
    budget: "12000",
    email: "billing@example.com",
    scope: HARBOR_SCOPE,
  },
] as const;
