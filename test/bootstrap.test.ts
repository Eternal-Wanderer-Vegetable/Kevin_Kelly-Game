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

import test from "node:test";
import assert from "node:assert/strict";
import { createRunId, projectName } from "../src/index.js";

test("project bootstrap exposes a stable project name", () => {
  assert.equal(projectName, "evolving-coding-harness");
});

test("run ids use the harness prefix and timestamp", () => {
  const runId = createRunId(new Date("2026-09-03T00:00:00.000Z"));
  assert.equal(runId, "run-20260903000000");
});
