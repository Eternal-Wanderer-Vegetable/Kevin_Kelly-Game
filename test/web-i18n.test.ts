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
import { describe, it } from "node:test";
import { en } from "../webui/src/i18n/en.js";
import type { Dictionary, MessageKey } from "../webui/src/i18n/en.js";
import { translate } from "../webui/src/i18n/en.js";
import { zhCN } from "../webui/src/i18n/zh-CN.js";

/**
 * Locale parity guard: whenever a language is added to the dashboard, the
 * dictionary lands here as a second import and every check below applies to
 * it automatically.
 */
const LOCALES: readonly { readonly id: string; readonly dictionary: Dictionary }[] = [
  { id: "zh-CN", dictionary: zhCN },
];

const tokens = (template: string): readonly string[] =>
  [...template.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1] ?? "")
    .sort();

describe("i18n dictionaries", () => {
  it("keeps every locale's key set identical to the reference", () => {
    const reference = Object.keys(en).sort();
    for (const locale of LOCALES) {
      assert.deepEqual(
        Object.keys(locale.dictionary).sort(),
        reference,
        `${locale.id} keys diverge from en`,
      );
    }
  });

  it("keeps placeholders identical to the reference for every key", () => {
    for (const [key, template] of Object.entries(en) as [
      MessageKey,
      string,
    ][]) {
      for (const locale of LOCALES) {
        assert.deepEqual(
          tokens(locale.dictionary[key]),
          tokens(template),
          `${locale.id}.${key} placeholders diverge from en`,
        );
      }
    }
  });

  it("keeps every translation non-empty", () => {
    for (const [key, template] of Object.entries(en) as [MessageKey, string][]) {
      assert.ok(template.trim().length > 0, `en.${key} is empty`);
      for (const locale of LOCALES) {
        assert.ok(
          locale.dictionary[key].trim().length > 0,
          `${locale.id}.${key} is empty`,
        );
      }
    }
  });

  it("replaces known placeholders and leaves unknown ones intact", () => {
    assert.equal(
      translate(en, "detail.liveEvents", { count: 42 }),
      "42 live events (last 500 kept)",
    );
    assert.equal(
      translate(en, "detail.liveEvents", { bogus: 1 }),
      "{count} live events (last 500 kept)",
    );
    assert.equal(
      translate(en, "repair.turnProgress", { turn: 3, max: 12 }),
      "turn 3 of 12",
    );
    assert.equal(
      translate(zhCN, "repair.turnProgress", { turn: 3, max: 12 }),
      "第 3 / 12 轮",
    );
  });
});
