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

import { Box, Text } from "ink";
import type { JSX } from "react";
import type { ReplTurn } from "./session.js";

export interface TurnViewProps {
  readonly turn: ReplTurn;
}

export function TurnView({ turn }: TurnViewProps): JSX.Element {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="white">
        {`Turn #${turn.index} `}
        <Text color="gray">{`(${turn.durationMs}ms)`}</Text>
      </Text>
      <Text color="cyan">
        {`  Observe ${turn.observation.kind}: ${JSON.stringify(turn.observation.content)}`}
      </Text>
      <Text color="yellow">
        {`  Think ${turn.action.type}: ${JSON.stringify(turn.action.input)}`}
      </Text>
      <Text color={turn.outcome.ok === false ? "red" : "green"}>
        {`  Act: ${JSON.stringify(turn.outcome)}`}
      </Text>
      {turn.error === undefined ? null : (
        <Text color="red">{`  Error: ${turn.error}`}</Text>
      )}
    </Box>
  );
}
