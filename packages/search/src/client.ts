/**
 * @proxyforge/search - minimal Meilisearch REST client (fetch-based, zero deps).
 *
 * We deliberately avoid the official `meilisearch` npm client: the surface we
 * need (ensure index, settings, add docs, search, await task) is small, and a
 * thin fetch wrapper keeps the dependency/GPL surface clean and the logic
 * unit-testable by injecting `fetchImpl`.
 */

export interface MeiliClientOptions {
  baseUrl: string;
  apiKey: string;
  /** injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** default waitForTask timeout (ms). */
  taskTimeoutMs?: number;
}

export interface EnqueuedTask {
  taskUid: number;
  indexUid: string | null;
  status: string;
  type: string;
}

export interface TaskView {
  uid: number;
  status: 'enqueued' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  error: { message: string; code?: string } | null;
}

export interface MeiliSearchResponse<T> {
  hits: T[];
  query: string;
  page: number;
  hitsPerPage: number;
  totalHits: number;
  totalPages: number;
  processingTimeMs: number;
}

export interface IndexSettings {
  searchableAttributes?: string[];
  filterableAttributes?: string[];
  sortableAttributes?: string[];
  rankingRules?: string[];
  /** Meili caps reported/ reachable hits at maxTotalHits (default 1000). */
  pagination?: { maxTotalHits?: number };
}

export class MeiliError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'MeiliError';
    this.status = status;
  }
}

export class MeiliClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly taskTimeoutMs: number;

  constructor(opts: MeiliClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    const f = opts.fetchImpl ?? globalThis.fetch;
    if (!f) throw new Error('no fetch implementation available (Node >=18 or inject fetchImpl)');
    this.fetchImpl = f;
    this.taskTimeoutMs = opts.taskTimeoutMs ?? 120_000;
  }

  private async raw(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, body);
    if (!res.ok) {
      let msg = `${method} ${path} -> ${res.status}`;
      try {
        const j = (await res.json()) as { message?: string };
        if (j?.message) msg = j.message;
      } catch {
        /* non-JSON error body */
      }
      throw new MeiliError(msg, res.status);
    }
    return (await res.json()) as T;
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.raw('GET', '/health');
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Create the index if it does not already exist (awaits creation). */
  async ensureIndex(uid: string, primaryKey: string): Promise<void> {
    const res = await this.raw('GET', `/indexes/${uid}`);
    if (res.ok) return;
    if (res.status !== 404) {
      throw new MeiliError(`GET /indexes/${uid} -> ${res.status}`, res.status);
    }
    const task = await this.json<EnqueuedTask>('POST', '/indexes', { uid, primaryKey });
    await this.waitForTask(task.taskUid);
  }

  async updateSettings(uid: string, settings: IndexSettings): Promise<EnqueuedTask> {
    return this.json<EnqueuedTask>('PATCH', `/indexes/${uid}/settings`, settings);
  }

  async addDocuments<T>(uid: string, docs: T[], primaryKey = 'id'): Promise<EnqueuedTask> {
    return this.json<EnqueuedTask>(
      'POST',
      `/indexes/${uid}/documents?primaryKey=${encodeURIComponent(primaryKey)}`,
      docs,
    );
  }

  async deleteIndex(uid: string): Promise<EnqueuedTask | null> {
    const res = await this.raw('DELETE', `/indexes/${uid}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new MeiliError(`DELETE /indexes/${uid} -> ${res.status}`, res.status);
    return (await res.json()) as EnqueuedTask;
  }

  async search<T>(uid: string, params: Record<string, unknown>): Promise<MeiliSearchResponse<T>> {
    return this.json<MeiliSearchResponse<T>>('POST', `/indexes/${uid}/search`, params);
  }

  async stats(uid: string): Promise<{ numberOfDocuments: number; isIndexing: boolean }> {
    return this.json('GET', `/indexes/${uid}/stats`);
  }

  async getTask(taskUid: number): Promise<TaskView> {
    return this.json<TaskView>('GET', `/tasks/${taskUid}`);
  }

  /** Poll a task until it succeeds; throw on failure / timeout. */
  async waitForTask(
    taskUid: number,
    opts: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<TaskView> {
    const timeoutMs = opts.timeoutMs ?? this.taskTimeoutMs;
    const intervalMs = opts.intervalMs ?? 250;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const task = await this.getTask(taskUid);
      if (task.status === 'succeeded') return task;
      if (task.status === 'failed' || task.status === 'canceled') {
        throw new MeiliError(
          `task ${taskUid} ${task.status}: ${task.error?.message ?? 'unknown error'}`,
          0,
        );
      }
      if (Date.now() > deadline) {
        throw new MeiliError(
          `task ${taskUid} timed out after ${timeoutMs}ms (status=${task.status})`,
          0,
        );
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
