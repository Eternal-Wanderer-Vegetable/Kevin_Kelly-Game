/*
 * Copyright (C) 2026 Vegetable
 *
 * This file is part of Evolving Coding Harness.
 *
 * Evolving Coding Harness is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3, or later.
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

import { render, Box, Text, useApp, useInput } from "ink";
import { useCallback, useState } from "react";
import type { JSX } from "react";
import { executeReplCommand, formatReplHelp } from "./commands.js";
import type { ReplSession, ReplTurn } from "./session.js";
import { TurnView } from "./turn-view.js";

export interface ReplAppProps {
  readonly session: ReplSession;
  readonly loadTask?: (path: string) => Promise<void>;
  readonly onExit?: () => Promise<void>;
}

export async function runTui(
  props: ReplAppProps,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    render(
      <ReplApp
        {...props}
        onExit={async () => {
          try {
            await props.onExit?.();
            resolve();
          } catch (error) {
            reject(error);
          }
        }}
      />,
      { exitOnCtrlC: false },
    );
  });
}

export function ReplApp({
  session,
  loadTask,
  onExit,
}: ReplAppProps): JSX.Element {
  const { exit } = useApp();
  const [turns, setTurns] = useState<readonly ReplTurn[]>(session.turns());
  const [line, setLine] = useState("");
  const [status, setStatus] = useState("ready");
  const [running, setRunning] = useState(false);

  const refreshTurns = useCallback((): void => {
    setTurns(session.turns());
  }, [session]);

  const execute = useCallback(
    async (input: string): Promise<void> => {
      if (input.trim() === "") return;
      if (running && !input.trim().startsWith("/stop")) {
        setStatus("a continuous run is active; use /stop first");
        return;
      }

      try {
        if (input.trim().startsWith("/run")) setRunning(true);
        const context = {
          session,
          isRunning: () => running,
          onReset: refreshTurns,
          onTurn: refreshTurns,
          write: (text: string) => setStatus(text.trimEnd()),
          quit: async () => {
            session.stop();
            await onExit?.();
            exit();
          },
          ...(loadTask === undefined ? {} : { loadTask }),
        };
        await executeReplCommand(input, context);
        refreshTurns();
        if (input.trim().startsWith("/run")) setStatus("run complete");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        if (input.trim().startsWith("/run")) setRunning(false);
      }
    },
    [exit, loadTask, onExit, refreshTurns, running, session],
  );

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      session.stop();
      setStatus("stop requested");
      return;
    }
    if (key.return) {
      const command = line;
      setLine("");
      void execute(command);
      return;
    }
    if (key.backspace || key.delete) {
      setLine((value) => value.slice(0, -1));
      return;
    }
    if (!key.ctrl && !key.meta) setLine((value) => `${value}${input}`);
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          Evolving Coding Harness
        </Text>
        <Text color={running ? "yellow" : "green"}>
          {running ? "running" : session.getLifecycle().toLowerCase()}
        </Text>
      </Box>
      <Text color="gray">
        {`goal: ${session.getGoal()} | provider: ${formatProvider(session.describeProvider())}`}
      </Text>
      <Text color="gray">
        {running ? "Ctrl+C or /stop to stop after the current turn" : "type /help for commands"}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {turns.slice(-12).map((turn) => (
          <TurnView key={turn.index} turn={turn} />
        ))}
      </Box>
      <Text color="gray">{status}</Text>
      <Box>
        <Text color="cyan">{"harness> "}</Text>
        <Text>{line}</Text>
      </Box>
      {line === "" && turns.length === 0 ? <Text color="gray">{formatReplHelp()}</Text> : null}
    </Box>
  );
}

function formatProvider(
  provider: Readonly<Record<string, unknown>>,
): string {
  return String(provider.provider ?? provider.model ?? "unknown");
}
