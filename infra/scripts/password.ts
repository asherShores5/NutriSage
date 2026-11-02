import { randomInt } from "node:crypto";

/**
 * A one-time sign-in password for a Member (used once, then a passkey). 24 random characters from
 * an alphabet with no look-alikes, at least one upper, lower and digit, shown as four groups of six.
 */
export function oneTimePassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789"];
  const all = sets.join("");
  const chars = sets.map((s) => s[randomInt(s.length)]);
  while (chars.length < 24) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("").replace(/(.{6})(?=.)/g, "$1-");
}
