"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_SETTINGS, parseSettings, type Settings } from "./settingsSchema";

export { activeProviderSettings, exportSettingsJson, importSettingsJson, DEFAULT_SETTINGS, parseSettings } from "./settingsSchema";
export type { ProviderSettings, Settings } from "./settingsSchema";

// The settings live on the StoryTime server (GET/PUT /api/settings), so every browser and
// session sees the same ones. This module keeps a copy in memory for the hooks to read.

const LEGACY_KEY = "storytime.settings.v1";
const listeners = new Set<() => void>();

let current: Settings = DEFAULT_SETTINGS;
let loadStarted = false;
let saving: Promise<unknown> = Promise.resolve();

function publish(next: Settings) {
  current = next;
  listeners.forEach((l) => l());
}

/** Settings this browser used to keep in localStorage, if any. */
function legacySettings(): Settings | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? parseSettings(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

async function load() {
  try {
    const res = await fetch("/api/settings", { cache: "no-store" });
    if (!res.ok) return;
    const body = (await res.json()) as { settings: Settings | null };
    if (body.settings) {
      publish(parseSettings(body.settings));
      return;
    }
    // Nothing on the server yet: adopt what this browser had, so upgrading loses nothing.
    const old = legacySettings();
    if (old) await saveSettings(old);
  } catch {
    // Offline or server down: keep the defaults.
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!loadStarted) {
    loadStarted = true;
    void load();
  }
  return () => {
    listeners.delete(cb);
  };
}

/** Applies the change immediately, then stores it on the server. Returns false if the server refused. */
export function saveSettings(next: Settings): Promise<boolean> {
  publish(next);
  const run = saving.then(async () => {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      return res.ok;
    } catch {
      return false;
    }
  });
  saving = run;
  return run;
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULT_SETTINGS);
}
