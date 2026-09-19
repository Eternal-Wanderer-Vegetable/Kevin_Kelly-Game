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
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import {
  en,
  translate,
  type Dictionary,
  type MessageKey,
  type TranslateParams,
} from "./en";
import { zhCN } from "./zh-CN";

export type { Dictionary, MessageKey, TranslateParams } from "./en";

/**
 * Adding a language is two steps:
 *
 * 1. create `webui/src/i18n/<tag>.ts` exporting a `Dictionary` (the `typeof en`
 *    annotation makes missing keys a compile error);
 * 2. register it in LOCALES below.
 *
 * `test/web-i18n.test.ts` enforces key and placeholder parity for every
 * registered locale, so an incomplete translation fails CI instead of a user.
 */

export type Language = "en" | "zh-CN";

interface LocaleDefinition {
  readonly id: Language;
  /** Displayed in the switcher in its own language; never translated. */
  readonly label: string;
  readonly dictionary: Dictionary;
}

const LOCALES: readonly LocaleDefinition[] = [
  { id: "en", label: "English", dictionary: en },
  { id: "zh-CN", label: "简体中文", dictionary: zhCN },
];

const STORAGE_KEY = "harness.webui.language";

/** BCP 47 primary subtag to a supported language; "en" is the fallback. */
const PRIMARY_LANGUAGE: Readonly<Record<string, Language>> = {
  en: "en",
  zh: "zh-CN",
};

export interface I18nContextValue {
  readonly language: Language;
  readonly setLanguage: (language: Language) => void;
  readonly t: Translate;
}

export type Translate = (key: MessageKey, params?: TranslateParams) => string;

function dictionaryFor(language: Language): Dictionary {
  const locale = LOCALES.find((candidate) => candidate.id === language);
  return locale?.dictionary ?? en;
}

/** Preferred language: saved choice first, then browser tags, then "en". */
export function detectLanguage(
  storage: Storage | null = typeof window === "undefined"
    ? null
    : window.localStorage,
  languages: readonly string[] =
    typeof navigator === "undefined" ? [] : navigator.languages,
): Language {
  if (storage !== null) {
    try {
      const saved = storage.getItem(STORAGE_KEY);
      if (saved !== null && LOCALES.some((locale) => locale.id === saved)) {
        return saved as Language;
      }
    } catch {
      // Storage can be unavailable (privacy modes); detection continues.
    }
  }
  for (const tag of languages) {
    const primary = tag.toLowerCase().split("-")[0] ?? "";
    const match = PRIMARY_LANGUAGE[primary];
    if (match !== undefined) return match;
  }
  return "en";
}

function persistLanguage(language: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Same as detection: a blocked store must not break the switcher.
  }
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  const [language, setLanguageState] = useState<Language>(() =>
    detectLanguage(),
  );

  const setLanguage = useCallback((next: Language): void => {
    setLanguageState(next);
    persistLanguage(next);
  }, []);

  const t = useCallback<Translate>(
    (key, params) => translate(dictionaryFor(language), key, params),
    [language],
  );

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nContextValue>(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (value === null) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}

/** Locale ids and their self-named labels, for the switcher. */
export function availableLocales(): readonly {
  readonly id: Language;
  readonly label: string;
}[] {
  return LOCALES.map(({ id, label }) => ({ id, label }));
}
