import fs from "fs";
import path from "path";
import type { Project } from "@/lib/types";

export interface SessionHit {
  sessionId: string;
  project: Project;
}

export interface MilestoneStore {
  read(sessionId: string): Promise<Project | null>;
  has(sessionId: string): Promise<boolean>;
  write(sessionId: string, project: Project | null): Promise<void>;
  update(sessionId: string, mutator: (project: Project) => Project | Promise<Project>): Promise<Project>;
  ensure(sessionId: string, seed: () => Project): Promise<Project | null>;
  findByInvoice(invoiceId: string): Promise<SessionHit | null>;
}

interface SessionRow {
  id: string;
  project: Project | null;
  updatedAt: string;
}

interface FileBlob {
  sessions: Record<string, SessionRow>;
}

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function storePath(): string {
  if (process.env.ZILLA_STORE_PATH) return process.env.ZILLA_STORE_PATH;
  if (process.env.VERCEL) return "/tmp/zilla-milestones.json";
  return path.join(process.cwd(), "data", "store.json");
}

function emptyBlob(): FileBlob {
  return { sessions: {} };
}

function readBlob(): FileBlob {
  const file = storePath();
  if (!fs.existsSync(file)) return emptyBlob();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      sessions?: Record<string, SessionRow>;
      project?: Project | null;
    };
    if (parsed?.sessions && typeof parsed.sessions === "object") {
      return { sessions: parsed.sessions };
    }
    if (parsed && "project" in parsed && parsed.project) {
      const project = parsed.project;
      return {
        sessions: {
          legacy: { id: "legacy", project, updatedAt: project.updatedAt },
        },
      };
    }
    return emptyBlob();
  } catch {
    return emptyBlob();
  }
}

function writeBlob(blob: FileBlob): void {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(blob, null, 2));
}

function touchRow(sessionId: string, project: Project | null): SessionRow {
  return { id: sessionId, project, updatedAt: new Date().toISOString() };
}

export class FileMilestoneStore implements MilestoneStore {
  private persist(sessionId: string, project: Project | null): void {
    const blob = readBlob();
    blob.sessions[sessionId] = touchRow(sessionId, project);
    writeBlob(blob);
  }

  async read(sessionId: string): Promise<Project | null> {
    return readBlob().sessions[sessionId]?.project ?? null;
  }

  async has(sessionId: string): Promise<boolean> {
    return Boolean(readBlob().sessions[sessionId]);
  }

  write(sessionId: string, project: Project | null): Promise<void> {
    return enqueue(async () => {
      this.persist(sessionId, project);
    });
  }

  update(sessionId: string, mutator: (project: Project) => Project | Promise<Project>): Promise<Project> {
    return enqueue(async () => {
      const current = readBlob().sessions[sessionId]?.project;
      if (!current) throw new Error("Create a milestone plan first");
      const next = await mutator(current);
      this.persist(sessionId, next);
      return next;
    });
  }

  ensure(sessionId: string, seed: () => Project): Promise<Project | null> {
    return enqueue(async () => {
      const existing = readBlob().sessions[sessionId];
      if (existing) return existing.project;
      const project = seed();
      this.persist(sessionId, project);
      return project;
    });
  }

  async findByInvoice(invoiceId: string): Promise<SessionHit | null> {
    for (const row of Object.values(readBlob().sessions)) {
      if (row.project?.phases.some((phase) => phase.paypalInvoiceId === invoiceId)) {
        return { sessionId: row.id, project: row.project };
      }
    }
    return null;
  }
}

interface SupabaseRow {
  id: string;
  project: Project | null;
  updated_at: string;
}

export class SupabaseMilestoneStore implements MilestoneStore {
  constructor(
    private readonly url: string,
    private readonly serviceRoleKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private endpoint(query = ""): string {
    const base = this.url.replace(/\/$/, "");
    return `${base}/rest/v1/zilla_sessions${query}`;
  }

  private headers(prefer?: string): Record<string, string> {
    return {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    };
  }

  private async rows(query: string): Promise<SupabaseRow[]> {
    const response = await this.fetchImpl(this.endpoint(query), { headers: this.headers() });
    if (!response.ok) {
      throw new Error(`Supabase read failed (${response.status})`);
    }
    return (await response.json()) as SupabaseRow[];
  }

  private async persist(sessionId: string, project: Project | null): Promise<void> {
    const response = await this.fetchImpl(this.endpoint("?on_conflict=id"), {
      method: "POST",
      headers: this.headers("resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify({
        id: sessionId,
        project,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      throw new Error(`Supabase write failed (${response.status})`);
    }
  }

  async read(sessionId: string): Promise<Project | null> {
    const found = await this.rows(`?id=eq.${encodeURIComponent(sessionId)}&select=id,project,updated_at`);
    return found[0]?.project ?? null;
  }

  async has(sessionId: string): Promise<boolean> {
    const found = await this.rows(`?id=eq.${encodeURIComponent(sessionId)}&select=id`);
    return found.length > 0;
  }

  write(sessionId: string, project: Project | null): Promise<void> {
    return enqueue(() => this.persist(sessionId, project));
  }

  update(sessionId: string, mutator: (project: Project) => Project | Promise<Project>): Promise<Project> {
    return enqueue(async () => {
      const current = await this.read(sessionId);
      if (!current) throw new Error("Create a milestone plan first");
      const next = await mutator(current);
      await this.persist(sessionId, next);
      return next;
    });
  }

  ensure(sessionId: string, seed: () => Project): Promise<Project | null> {
    return enqueue(async () => {
      const found = await this.rows(`?id=eq.${encodeURIComponent(sessionId)}&select=id,project,updated_at`);
      if (found.length > 0) return found[0]?.project ?? null;
      const project = seed();
      await this.persist(sessionId, project);
      return project;
    });
  }

  async findByInvoice(invoiceId: string): Promise<SessionHit | null> {
    const found = await this.rows("?select=id,project,updated_at&order=updated_at.desc&limit=200");
    for (const row of found) {
      if (row.project?.phases.some((phase) => phase.paypalInvoiceId === invoiceId)) {
        return { sessionId: row.id, project: row.project };
      }
    }
    return null;
  }
}

const fileStore = new FileMilestoneStore();

export function getStore(): MilestoneStore {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return new SupabaseMilestoneStore(url, key);
  return fileStore;
}

export function resetStoreQueueForTests(): void {
  queue = Promise.resolve();
}
