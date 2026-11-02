// Days (schema/days.graphql). One file per entity, like api/src/resolvers.
// A Guest's Days come from this device instead (guest/store.ts).
import type { Day } from "@nutrisage/shared";
import { guestDays, putGuestDay } from "../guest/store";
import { isGuest } from "../session";
import { NUTRITION, gql } from "./gql";

const DAY = `date entries { id meal name nutrition { ${NUTRITION} } grams amount unit } water weight updatedAt`;

export async function getDays(from: string, to: string): Promise<Day[]> {
  if (isGuest()) return guestDays(from, to);
  return (await gql<{ days: Day[] }>(`query($from: String!, $to: String!) { days(from: $from, to: $to) { ${DAY} } }`, { from, to })).days;
}

/** Write the whole Day (last write wins). */
export async function putDay(day: Day): Promise<Day> {
  if (isGuest()) return putGuestDay(day);
  const input = { date: day.date, entries: day.entries, water: day.water ?? null, weight: day.weight ?? null };
  return (await gql<{ putDay: Day }>(`mutation($input: DayInput!) { putDay(input: $input) { ${DAY} } }`, { input })).putDay;
}
