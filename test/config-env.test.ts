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

import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configInputFromEnvironment, loadConfig } from "../src/config.js";

test("configInputFromEnvironment converts every recognised variable", () => {
  const input = configInputFromEnvironment({
    HARNESS_DATA_DIR: "/srv/harness/data",
    HARNESS_EVENT_LOG: "/srv/harness/data/runs/events.jsonl",
    HARNESS_DEFAULT_ENERGY: "250",
    HARNESS_LOCAL_MODEL_URL: "http://model:8000/v1",
    HARNESS_EXTERNAL_MODEL_URL: "https://api.example.com/v1",
  });

  assert.deepEqual(input, {
    dataDirectory: "/srv/harness/data",
    eventLogPath: "/srv/harness/data/runs/events.jsonl",
    defaultEnergy: 250,
    localModelUrl: "http://model:8000/v1",
    externalModelUrl: "https://api.example.com/v1",
  });
});

test("configInputFromEnvironment produces no fields for an empty environment", () => {
  assert.deepEqual(configInputFromEnvironment({}), {});
  assert.equal(Object.keys(configInputFromEnvironment({})).length, 0);
});

test("configInputFromEnvironment treats blank values as unset", () => {
  // Container orchestration commonly passes empty strings for unset variables;
  // those must not override defaults.
  const input = configInputFromEnvironment({
    HARNESS_DATA_DIR: "",
    HARNESS_LOCAL_MODEL_URL: "   ",
  });
  assert.deepEqual(input, {});
});

test("configInputFromEnvironment trims surrounding whitespace", () => {
  const input = configInputFromEnvironment({
    HARNESS_LOCAL_MODEL_URL: "  http://model:8000/v1  ",
  });
  assert.deepEqual(input, { localModelUrl: "http://model:8000/v1" });
});

test("configInputFromEnvironment ignores unrelated variables", () => {
  const input = configInputFromEnvironment({
    PATH: "/usr/bin",
    HARNESS_LOCAL_MODEL_KEY: "secret-key",
  });
  // Keys never enter HarnessConfig: it is hashed into experiment records.
  assert.deepEqual(input, {});
});

test("environment values flow through loadConfig validation", () => {
  const cwd = join(tmpdir(), "config-env");
  const config = loadConfig(
    configInputFromEnvironment({
      HARNESS_DEFAULT_ENERGY: "42",
      HARNESS_LOCAL_MODEL_URL: "http://model:8000/v1",
    }),
    cwd,
  );

  assert.equal(config.defaultEnergy, 42);
  assert.equal(config.localModelUrl, "http://model:8000/v1");
  assert.equal(config.dataDirectory, join(cwd, "data"));
  assert.equal(config.externalModelUrl, undefined);
});

test("loadConfig rejects an unparseable energy value from the environment", () => {
  assert.throws(
    () =>
      loadConfig(
        configInputFromEnvironment({ HARNESS_DEFAULT_ENERGY: "plenty" }),
      ),
    /defaultEnergy must be a non-negative/,
  );
});

test("loadConfig rejects a negative energy value from the environment", () => {
  assert.throws(
    () =>
      loadConfig(configInputFromEnvironment({ HARNESS_DEFAULT_ENERGY: "-1" })),
    /defaultEnergy must be a non-negative/,
  );
});

test("loadConfig rejects a non-HTTP model URL from the environment", () => {
  assert.throws(
    () =>
      loadConfig(
        configInputFromEnvironment({
          HARNESS_LOCAL_MODEL_URL: "file:///models/local",
        }),
      ),
    /localModelUrl must be an HTTP/,
  );
});

test("command line overrides take precedence over the environment", () => {
  const cwd = join(tmpdir(), "config-env-precedence");
  const config = loadConfig(
    {
      ...configInputFromEnvironment({
        HARNESS_LOCAL_MODEL_URL: "http://from-env:8000/v1",
        HARNESS_DEFAULT_ENERGY: "10",
      }),
      localModelUrl: "http://from-cli:9000/v1",
    },
    cwd,
  );

  assert.equal(config.localModelUrl, "http://from-cli:9000/v1");
  assert.equal(config.defaultEnergy, 10);
});
