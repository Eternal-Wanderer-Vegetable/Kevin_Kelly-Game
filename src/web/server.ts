/*
 * Copyright (C) 2026 Vegetable
 *
 * This file is part of Evolving Coding Harness.
 *
 * Evolving Coding Harness is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Evolving Coding Harness is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Evolving Coding Harness. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  readFile,
  readdir,
  stat,
} from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { RunStore, type RunListItem, type RunSummary } from "./run-store.js";
import { statEventsFile, tailEvents } from "./tail.js";

export interface WebUiServerOptions {
  readonly host: string;
  readonly port: number;
  readonly eventLogPath: string;
  readonly defaultEnergy: number;
  /** Directory of experiment artifacts exposed read-only. Absent disables it. */
  readonly artifactsDir?: string;
  /** Built SPA root (dist/webui). Absent makes every non-API page a 503. */
  readonly staticRoot?: string;
  /** When set, every request must present it; when unset the server is open. */
  readonly token?: string;
  readonly pollIntervalMs?: number;
  readonly stalledAfterMs?: number;
  readonly now?: () => number;
  /** Per-request log sink; the CLI passes io.out, tests stay silent. */
  readonly onRequest?: (line: string) => void;
}

export interface RunningWebUiServer {
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

interface ParsedRequest {
  readonly url: URL;
  readonly method: string;
}

const DEFAULT_POLL_INTERVAL_MS = 1500;
const MAX_EVENT_LIMIT = 1000;
const ARTIFACT_LIST_LIMIT = 2000;
const ARTIFACT_PREVIEW_LIMIT = 512 * 1024;
const SSE_HEARTBEAT_POLLS = 10;

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * The read-only dashboard server.
 *
 * Everything here is observation: the only inputs are the append-only event
 * log and the artifacts directory, both treated as immutable, and no route
 * writes anything. When `token` is unset the server is open — that is the
 * local-and-tunnel deployment; a token turns on Bearer/query checks for every
 * route including the SPA assets.
 */
export async function startWebUiServer(
  options: WebUiServerOptions,
): Promise<RunningWebUiServer> {
  const store = new RunStore({
    eventLogPath: options.eventLogPath,
    defaultEnergy: options.defaultEnergy,
    ...(options.stalledAfterMs === undefined
      ? {}
      : { stalledAfterMs: options.stalledAfterMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const activeStreams = new Set<ServerResponse>();

  const server: Server = createServer((request, response) => {
    void handleRequest(request, response, {
      options,
      store,
      pollIntervalMs,
      activeStreams,
    }).catch((error: unknown) => {
      if (!response.headersSent) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        response.end();
      }
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, options.host, () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  const boundPort =
    typeof address === "object" && address !== null ? address.port : options.port;

  return {
    host: options.host,
    port: boundPort,
    close: () =>
      new Promise<void>((resolveClose) => {
        for (const stream of activeStreams) stream.end();
        activeStreams.clear();
        server.close(() => resolveClose());
      }),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: {
    readonly options: WebUiServerOptions;
    readonly store: RunStore;
    readonly pollIntervalMs: number;
    readonly activeStreams: Set<ServerResponse>;
  },
): Promise<void> {
  const { options } = context;
  const parsed: ParsedRequest = {
    url: new URL(request.url ?? "/", "http://localhost"),
    method: request.method ?? "GET",
  };
  options.onRequest?.(`${parsed.method} ${parsed.url.pathname}`);

  if (parsed.method !== "GET" && parsed.method !== "HEAD") {
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }
  if (!isAuthorized(request, parsed.url, options.token)) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }

  const pathname = parsed.url.pathname;
  if (pathname === "/api/runs") {
    const runs: readonly RunListItem[] = await context.store.listRuns();
    sendJson(response, 200, { runs, generatedAt: new Date().toISOString() });
    return;
  }
  if (pathname.startsWith("/api/runs/") && pathname.endsWith("/summary")) {
    const runId = decodeSegment(
      pathname.slice("/api/runs/".length, -"/summary".length),
    );
    const summary: RunSummary | null = await context.store.summarizeRun(runId);
    if (summary === null) {
      sendJson(response, 404, { error: `unknown run: ${runId}` });
      return;
    }
    sendJson(response, 200, summary);
    return;
  }
  if (pathname === "/api/events") {
    await sendEvents(response, parsed.url, options);
    return;
  }
  if (pathname === "/api/stream") {
    sendStream(request, response, parsed.url, options, context);
    return;
  }
  if (pathname === "/api/artifacts") {
    await sendArtifactListing(response, options);
    return;
  }
  if (pathname.startsWith("/api/artifacts/")) {
    await sendArtifactFile(response, pathname, options);
    return;
  }
  if (pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "not found" });
    return;
  }
  await sendStatic(response, pathname, options);
}

function isAuthorized(
  request: IncomingMessage,
  url: URL,
  token: string | undefined,
): boolean {
  if (token === undefined || token === "") return true;
  const header = request.headers.authorization;
  if (
    typeof header === "string" &&
    header.startsWith("Bearer ") &&
    header.slice("Bearer ".length) === token
  ) {
    return true;
  }
  // EventSource cannot set headers, so the token may travel in the query.
  return url.searchParams.get("token") === token;
}

async function sendEvents(
  response: ServerResponse,
  url: URL,
  options: WebUiServerOptions,
): Promise<void> {
  const after = numberParam(url, "after") ?? 0;
  const limit = Math.min(numberParam(url, "limit") ?? 200, MAX_EVENT_LIMIT);
  const runFilter = optionalParam(url, "run");
  const typeFilter = optionalParam(url, "type");

  const tail = await tailEvents(options.eventLogPath, after, limit);
  const events = tail.events.filter(
    (event) =>
      (runFilter === undefined || event.runId === runFilter) &&
      (typeFilter === undefined || event.type === typeFilter),
  );
  sendJson(response, 200, {
    events,
    nextOffset: tail.nextOffset,
    skipped: tail.skipped,
  });
}

function sendStream(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: WebUiServerOptions,
  context: {
    readonly store: RunStore;
    readonly pollIntervalMs: number;
    readonly activeStreams: Set<ServerResponse>;
  },
): Promise<void> {
  const runFilter = optionalParam(url, "run");
  const resumeOffset =
    numberParam(url, "after") ??
    numberFrom(request.headers["last-event-id"]) ??
    0;

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.write("retry: 3000\n\n");
  context.activeStreams.add(response);

  let offset = resumeOffset;
  let pollsSinceFlush = 0;
  const timer = setInterval(() => {
    void (async () => {
      pollsSinceFlush += 1;
      const status = await statEventsFile(options.eventLogPath);
      if (status === null || status.size <= offset) return;
      const tail = await tailEvents(options.eventLogPath, offset, 500);
      if (tail.events.length > 0) {
        offset = tail.nextOffset;
        const events = tail.events.filter(
          (event) => runFilter === undefined || event.runId === runFilter,
        );
        if (events.length > 0) {
          // One frame per flush carrying the file-level offset: the client
          // resumes from `id` regardless of which runs it filters for.
          response.write(
            `id: ${tail.nextOffset}\nevent: batch\ndata: ${JSON.stringify({
              events,
              nextOffset: tail.nextOffset,
              skipped: tail.skipped,
            })}\n\n`,
          );
        }
      } else if (tail.skipped > 0) {
        offset = tail.nextOffset;
      }
      if (pollsSinceFlush >= SSE_HEARTBEAT_POLLS) {
        pollsSinceFlush = 0;
        response.write(": ping\n\n");
      }
    })().catch(() => {
      clearInterval(timer);
      response.end();
      context.activeStreams.delete(response);
    });
  }, context.pollIntervalMs);

  request.on("close", () => {
    clearInterval(timer);
    context.activeStreams.delete(response);
  });
  return Promise.resolve();
}

async function sendArtifactListing(
  response: ServerResponse,
  options: WebUiServerOptions,
): Promise<void> {
  if (options.artifactsDir === undefined) {
    sendJson(response, 404, { error: "artifacts directory not configured" });
    return;
  }
  const entries = await listArtifacts(options.artifactsDir);
  sendJson(response, 200, { entries, generatedAt: new Date().toISOString() });
}

async function listArtifacts(
  root: string,
  relative = "",
  depth = 0,
): Promise<readonly ArtifactEntry[]> {
  if (depth > 6) return [];
  const absolute = relative === "" ? root : join(root, relative);
  const dirents = await readdir(absolute, { withFileTypes: true });
  const entries: ArtifactEntry[] = [];
  for (const dirent of dirents) {
    const childRelative = relative === "" ? dirent.name : `${relative}/${dirent.name}`;
    if (dirent.isDirectory()) {
      entries.push({
        path: childRelative,
        type: "directory",
        size: null,
        mtimeMs: null,
      });
      if (entries.length >= ARTIFACT_LIST_LIMIT) return entries;
      entries.push(
        ...(await listArtifacts(root, childRelative, depth + 1)),
      );
    } else if (dirent.isFile()) {
      const stats = await stat(join(root, childRelative));
      entries.push({
        path: childRelative,
        type: "file",
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      });
    }
    if (entries.length >= ARTIFACT_LIST_LIMIT) return entries;
  }
  return entries;
}

interface ArtifactEntry {
  readonly path: string;
  readonly type: "file" | "directory";
  readonly size: number | null;
  readonly mtimeMs: number | null;
}

async function sendArtifactFile(
  response: ServerResponse,
  pathname: string,
  options: WebUiServerOptions,
): Promise<void> {
  if (options.artifactsDir === undefined) {
    sendJson(response, 404, { error: "artifacts directory not configured" });
    return;
  }
  const relative = decodeSegment(pathname.slice("/api/artifacts/".length));
  const root = resolve(options.artifactsDir);
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(root + sep)) {
    sendJson(response, 400, { error: "path escapes the artifacts directory" });
    return;
  }
  let content: string;
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
    if (info.size > ARTIFACT_PREVIEW_LIMIT) {
      sendJson(response, 413, { error: "artifact too large to preview" });
      return;
    }
    content = await readFile(target, "utf8");
  } catch {
    sendJson(response, 404, { error: "artifact not found" });
    return;
  }
  sendJson(response, 200, { path: relative, content });
}

async function sendStatic(
  response: ServerResponse,
  pathname: string,
  options: WebUiServerOptions,
): Promise<void> {
  if (options.staticRoot === undefined) {
    sendJson(response, 503, {
      error: "dashboard frontend is not built; run: npm run build",
    });
    return;
  }
  const root = resolve(options.staticRoot);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const candidates = [relative];
  // SPA fallback: a client-side route without a file extension gets the shell.
  if (extname(relative) === "" && relative !== "index.html") {
    candidates.push("index.html");
  }

  for (const candidate of candidates) {
    const target = resolve(root, candidate);
    if (target !== root && !target.startsWith(root + sep)) continue;
    try {
      const info = await stat(target);
      if (!info.isFile()) continue;
      const body = await readFile(target);
      response.writeHead(200, {
        "content-type": MIME_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
        "content-length": body.length,
      });
      response.end(body);
      return;
    } catch {
      // Try the next candidate; falling through means 404 below.
    }
  }
  sendJson(response, 404, { error: "not found" });
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function optionalParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null || value === "" ? undefined : value;
}

function numberParam(url: URL, name: string): number | undefined {
  const raw = optionalParam(url, name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function numberFrom(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
