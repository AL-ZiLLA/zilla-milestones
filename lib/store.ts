import fs from "fs";
import path from "path";
import type { Project, StoreData } from "@/lib/types";

function storePath(): string {
  if (process.env.ZILLA_STORE_PATH) return process.env.ZILLA_STORE_PATH;
  if (process.env.VERCEL) return "/tmp/zilla-milestones.json";
  return path.join(process.cwd(), "data", "store.json");
}

function emptyStore(): StoreData {
  return { project: null };
}

function readStore(): StoreData {
  const file = storePath();
  if (!fs.existsSync(file)) return emptyStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StoreData;
    if (!parsed || typeof parsed !== "object") return emptyStore();
    return { project: parsed.project ?? null };
  } catch {
    return emptyStore();
  }
}

function writeStore(data: StoreData): void {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => T | Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function readProject(): Project | null {
  return readStore().project;
}

export function saveProject(project: Project | null): Project | null {
  writeStore({ project });
  return project;
}

export function updateProject(mutator: (project: Project) => Project | Promise<Project>): Promise<Project> {
  return enqueue(async () => {
    const current = readStore().project;
    if (!current) throw new Error("Create a milestone plan first");
    const next = await mutator(current);
    writeStore({ project: next });
    return next;
  });
}
