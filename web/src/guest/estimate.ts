// Guest estimates: the separate, unauthenticated Guest endpoint (api/src/guest.ts), capped per IP
// and per day on the server. Its refusal messages are written for people, so they show as is.
import { getConfig } from "../config";
import type { Estimate } from "../api/estimate";

const UNAVAILABLE = "Couldn't estimate that right now. Try again, or type the nutrition by hand.";

/** The Guest endpoint's reply: an estimate, never saved anywhere on the server. */
export async function guestEstimate(text: string, opts: { ingredient?: boolean } = {}): Promise<Omit<Estimate, "food">> {
  const url = getConfig().guestEstimateUrl;
  if (!url) throw new Error(UNAVAILABLE);
  let r: Response;
  try {
    r = await fetch(`${url.replace(/\/$/, "")}/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts.ingredient ? { text, ingredient: true } : { text }),
    });
  } catch {
    throw new Error(UNAVAILABLE);
  }
  const body = await r.json().catch(() => undefined);
  if (!r.ok) throw new Error(typeof body?.message === "string" ? body.message : UNAVAILABLE);
  return body as Omit<Estimate, "food">;
}
