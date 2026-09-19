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

import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type {
  ArtifactEntry,
  DashboardEvent,
  RunListItem,
  RunSummary,
} from "./api";
import {
  fetchArtifact,
  fetchArtifacts,
  fetchRuns,
  fetchSummary,
  openEventStream,
} from "./api";
import {
  availableLocales,
  useI18n,
  type Language,
  type MessageKey,
} from "./i18n";

type Route =
  | { readonly view: "runs" }
  | { readonly view: "artifacts" }
  | { readonly view: "run"; readonly runId: string };

function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, "");
  if (clean === "artifacts") return { view: "artifacts" };
  if (clean.startsWith("run/")) {
    return { view: "run", runId: decodeURIComponent(clean.slice("run/".length)) };
  }
  return { view: "runs" };
}

/** Badge labels are messages; the CSS class stays the raw status value. */
const STATUS_MESSAGE_KEYS: Readonly<Record<string, MessageKey>> = {
  running: "status.running",
  completed: "status.completed",
  error: "status.error",
  stalled: "status.stalled",
  active: "status.active",
  dormant: "status.dormant",
  dead: "status.dead",
};

export function App(): JSX.Element {
  const { t } = useI18n();
  const [route, setRoute] = useState<Route>(() =>
    parseHash(window.location.hash),
  );

  useEffect(() => {
    const onHashChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <a href="#/">{t("app.title")}</a>
        </h1>
        <nav>
          <a href="#/">{t("nav.runs")}</a>
          <a href="#/artifacts">{t("nav.artifacts")}</a>
        </nav>
        <LanguageSwitcher />
      </header>
      <main>
        {route.view === "runs" && <RunsView />}
        {route.view === "run" && <RunDetailView runId={route.runId} />}
        {route.view === "artifacts" && <ArtifactsView />}
      </main>
    </div>
  );
}

function LanguageSwitcher(): JSX.Element {
  const { language, setLanguage, t } = useI18n();
  return (
    <label className="language">
      <span className="muted">{t("language.label")}</span>
      <select
        value={language}
        aria-label={t("language.label")}
        onChange={(change) => setLanguage(change.target.value as Language)}
      >
        {availableLocales().map((locale) => (
          <option key={locale.id} value={locale.id}>
            {locale.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RunsView(): JSX.Element {
  const { t } = useI18n();
  const [runs, setRuns] = useState<readonly RunListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const page = await fetchRuns();
        if (!cancelled) {
          setRuns(page.runs);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) setError(describe(cause));
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (error !== null) return <ErrorNotice message={error} />;
  if (runs === null) return <p className="muted">{t("runs.loading")}</p>;
  if (runs.length === 0) {
    return <p className="muted">{t("runs.empty")}</p>;
  }

  return (
    <table className="runs">
      <thead>
        <tr>
          <th>{t("runs.column.run")}</th>
          <th>{t("runs.column.status")}</th>
          <th>{t("runs.column.events")}</th>
          <th>{t("runs.column.started")}</th>
          <th>{t("runs.column.last")}</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.runId}>
            <td>
              <a href={`#/run/${encodeURIComponent(run.runId)}`}>
                {run.runId}
              </a>
            </td>
            <td>
              <StatusBadge status={run.status} />
            </td>
            <td>{run.eventCount}</td>
            <td>{formatTime(run.firstTimestamp)}</td>
            <td>
              {formatTime(run.lastTimestamp)}
              {run.lastEventType !== null && (
                <span className="muted"> · {run.lastEventType}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RunDetailView({ runId }: { readonly runId: string }): JSX.Element {
  const { t, language } = useI18n();
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [events, setEvents] = useState<readonly DashboardEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const summaryTimer = useRef<number | null>(null);

  const loadSummary = useCallback(async (): Promise<void> => {
    try {
      setSummary(await fetchSummary(runId));
      setError(null);
    } catch (cause) {
      setError(describe(cause));
    }
  }, [runId]);

  useEffect(() => {
    setSummary(null);
    setEvents([]);
    setError(null);
    void loadSummary();
    // The stream covers live events; the interval is the safety net for
    // stalls that produce no events at all.
    const refresh = window.setInterval(() => {
      void loadSummary();
    }, 8000);
    const source = openEventStream(runId, (page) => {
      setEvents((current) => [...current, ...page.events].slice(-500));
      if (summaryTimer.current !== null) {
        window.clearTimeout(summaryTimer.current);
      }
      summaryTimer.current = window.setTimeout(() => {
        void loadSummary();
      }, 400);
    });
    return () => {
      window.clearInterval(refresh);
      source.close();
      if (summaryTimer.current !== null) {
        window.clearTimeout(summaryTimer.current);
      }
    };
  }, [runId, loadSummary]);

  const visible =
    typeFilter === "" ? events : events.filter((item) => item.type === typeFilter);
  const types = [...new Set(events.map((item) => item.type))].sort();

  return (
    <section className="detail">
      <p>
        <a href="#/">{t("detail.back")}</a>
      </p>
      <h2 className="run-title">
        {runId} {summary !== null && <StatusBadge status={summary.status} />}
      </h2>
      {error !== null && <ErrorNotice message={error} />}
      {summary !== null && (
        <>
          <dl className="facts">
            <div>
              <dt>{t("detail.events")}</dt>
              <dd>{summary.eventCount}</dd>
            </div>
            <div>
              <dt>{t("detail.agents")}</dt>
              <dd>{summary.agents.length}</dd>
            </div>
            <div>
              <dt>{t("detail.initialEnergy")}</dt>
              <dd>{summary.initialEnergy}</dd>
            </div>
          </dl>
          {summary.warnings.length > 0 && (
            <ul className="warnings">
              {summary.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <h3>{t("detail.agentsHeading")}</h3>
          {summary.agents.length === 0 ? (
            <p className="muted">{t("detail.noAgents")}</p>
          ) : (
            <div className="agents">
              {summary.agents.map((agent) => (
                <div className="agent-card" key={agent.agentId}>
                  <strong>{agent.agentId}</strong>
                  {agent.lifecycle !== null && (
                    <StatusBadge status={agent.lifecycle.toLowerCase()} />
                  )}
                  <span className="muted">
                    {t("detail.energyLabel")}{" "}
                    {agent.energy === null
                      ? t("detail.energyUnavailable")
                      : agent.energy}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <GenerationProgress events={events} />
      <RepairProgress events={events} />
      <h3>{t("detail.streamHeading")}</h3>
      <p className="muted">{t("detail.liveEvents", { count: events.length })}</p>
      {types.length > 1 && (
        <label className="filter">
          {t("detail.filterType")}{" "}
          <select
            value={typeFilter}
            onChange={(change) => setTypeFilter(change.target.value)}
          >
            <option value="">{t("detail.filterAll")}</option>
            {types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      )}
      <table className="events">
        <thead>
          <tr>
            <th>{t("events.column.time")}</th>
            <th>{t("events.column.type")}</th>
            <th>{t("events.column.agent")}</th>
            <th>{t("events.column.detail")}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((item) => (
            <tr key={item.eventId}>
              <td>{formatTime(item.timestamp, language)}</td>
              <td>
                <code>{item.type}</code>
              </td>
              <td>{item.agentId ?? "—"}</td>
              <td className="payload">{describePayload(item)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function GenerationProgress({
  events,
}: {
  readonly events: readonly DashboardEvent[];
}): JSX.Element | null {
  const { t } = useI18n();
  const started = events.filter(
    (item) => item.type === "GENERATION_STARTED",
  ).length;
  if (started === 0) return null;
  const completed = events.filter(
    (item) => item.type === "GENERATION_COMPLETED",
  ).length;
  return (
    <div className="progress-block">
      <h3>{t("generations.heading")}</h3>
      <p>{t("generations.summary", { completed, started })}</p>
      <Progress value={completed} total={started} />
    </div>
  );
}

function RepairProgress({
  events,
}: {
  readonly events: readonly DashboardEvent[];
}): JSX.Element | null {
  const { t } = useI18n();
  const start = [...events]
    .reverse()
    .find((item) => item.type === "REPAIR_STARTED");
  if (start === undefined) return null;
  const payload = start.payload as { taskId?: unknown; maxTurns?: unknown };
  const maxTurns =
    typeof payload.maxTurns === "number" ? payload.maxTurns : undefined;
  const taskId = typeof payload.taskId === "string" ? payload.taskId : "";
  const turns = events.filter((item) => item.type === "REPAIR_TURN").length;
  const acceptance = [...events]
    .reverse()
    .find((item) => item.type === "REPAIR_ACCEPTANCE");
  const acceptanceResult =
    acceptance === undefined
      ? undefined
      : (acceptance.payload as { result?: { taskSuccess?: unknown } }).result;
  const error = [...events]
    .reverse()
    .find((item) => item.type === "REPAIR_ERROR");

  return (
    <div className="progress-block">
      <h3>{t("repair.heading")}</h3>
      <p>
        {t("repair.taskLabel")} <code>{taskId || t("repair.taskUnknown")}</code>{" "}
        ·{" "}
        {maxTurns !== undefined
          ? t("repair.turnProgress", { turn: turns, max: maxTurns })
          : t("repair.turnCount", { turn: turns })}
      </p>
      {maxTurns !== undefined && <Progress value={turns} total={maxTurns} />}
      {acceptanceResult !== undefined && (
        <p>
          {t("repair.acceptance")}{" "}
          {acceptanceResult.taskSuccess === true ? (
            <span className="badge ok">{t("repair.passed")}</span>
          ) : (
            <span className="badge fail">{t("repair.failed")}</span>
          )}
        </p>
      )}
      {error !== undefined && (
        <p className="error-line">
          {t("repair.error")} {describePayload(error)}
        </p>
      )}
    </div>
  );
}

function Progress({
  value,
  total,
}: {
  readonly value: number;
  readonly total: number;
}): JSX.Element {
  const percent = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

function ArtifactsView(): JSX.Element {
  const { t } = useI18n();
  const [entries, setEntries] = useState<readonly ArtifactEntry[] | null>(null);
  const [selected, setSelected] = useState<{
    readonly path: string;
    readonly content: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchArtifacts()
      .then((page) => setEntries(page.entries))
      .catch((cause) => setError(describe(cause)));
  }, []);

  const open = async (path: string): Promise<void> => {
    try {
      setSelected(await fetchArtifact(path));
    } catch (cause) {
      setError(describe(cause));
    }
  };

  if (error !== null) return <ErrorNotice message={error} />;
  if (entries === null) return <p className="muted">{t("artifacts.loading")}</p>;

  return (
    <section>
      <h2>{t("artifacts.heading")}</h2>
      <div className="artifact-layout">
        <ul className="artifact-list">
          {entries.length === 0 && (
            <li className="muted">{t("artifacts.empty")}</li>
          )}
          {entries.map((entry) =>
            entry.type === "file" ? (
              <li key={entry.path}>
                <button type="button" onClick={() => void open(entry.path)}>
                  {entry.path}
                </button>
                {entry.size !== null && (
                  <span className="muted"> · {formatBytes(entry.size)}</span>
                )}
              </li>
            ) : (
              <li key={entry.path} className="muted">
                {entry.path}/
              </li>
            ),
          )}
        </ul>
        {selected !== null && (
          <div className="artifact-preview">
            <h3>{selected.path}</h3>
            <pre>{selected.content}</pre>
          </div>
        )}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { readonly status: string }): JSX.Element {
  const { t } = useI18n();
  const messageKey = STATUS_MESSAGE_KEYS[status];
  return (
    <span className={`badge ${messageKey === undefined ? "other" : status}`}>
      {messageKey === undefined ? t("status.other") : t(messageKey)}
    </span>
  );
}

function ErrorNotice({ message }: { readonly message: string }): JSX.Element {
  const { t } = useI18n();
  return <p className="error-line">{t("detail.failed", { message })}</p>;
}

function describePayload(event: DashboardEvent): string {
  const interesting = Object.entries(event.payload).filter(
    ([key]) => key !== "transaction",
  );
  if (interesting.length === 0) return "—";
  const text = JSON.stringify(Object.fromEntries(interesting));
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

function formatTime(iso: string | null, language?: string): string {
  if (iso === null) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString(language, { hour12: false });
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
