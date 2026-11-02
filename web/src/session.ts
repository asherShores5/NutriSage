// Guest mode (spec: Guest access): using NutriSage without signing in. The flag lives in this
// browser only; a Guest's data is in guest/store.ts. The api/ modules check isGuest() and answer
// from the device (and the Guest estimate endpoint) instead of the Member API, so screens work
// the same for Guests and Members.
import { dateKey } from "@nutrisage/shared";
import { clearGuestData, seedGuestData } from "./guest/store";

const FLAG = "nutrisage.guest";
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export const isGuest = () => localStorage.getItem(FLAG) === "1";

/** Start (or resume) Guest mode; demo Days and a demo Library are seeded the first time. */
export function enterGuest() {
  seedGuestData(dateKey(new Date()));
  localStorage.setItem(FLAG, "1");
  changed();
}

/** End Guest mode and delete the Guest's data from this device. */
export function leaveGuest() {
  localStorage.removeItem(FLAG);
  clearGuestData();
  changed();
}

/** Subscribe to Guest mode starting or ending (for useSyncExternalStore). */
export function onSessionChange(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
