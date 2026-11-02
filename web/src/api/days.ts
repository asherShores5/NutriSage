// Days (schema/days.graphql). One file per entity, like api/src/resolvers.
import type { Day } from "@nutrisage/shared";
import { NUTRITION, gql } from "./gql";

const DAY = `date entries { id meal name nutrition { ${NUTRITION} } grams } water weight updatedAt`;

export async function getDays(from: string, to: string): Promise<Day[]> {
  return (await gql<{ days: Day[] }>(`query($from: String!, $to: String!) { days(from: $from, to: $to) { ${DAY} } }`, { from, to })).days;
}

/** Write the whole Day (last write wins). */
export async function putDay(day: Day): Promise<Day> {
  const input = { date: day.date, entries: day.entries, water: day.water ?? null, weight: day.weight ?? null };
  return (await gql<{ putDay: Day }>(`mutation($input: DayInput!) { putDay(input: $input) { ${DAY} } }`, { input })).putDay;
}
