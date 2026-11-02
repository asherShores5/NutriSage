// Bedrock nutrition estimates for Members (spec: Estimates). Schema: schema/estimate.graphql.
// The work is in ../estimate.ts, which the Guest endpoint (ticket 10) reuses with its own caps
// (and without the Library: a Guest never writes the household table).
import { estimateFood } from "../estimate";
import { addEstimatedFood } from "./library";
import type { ResolverModule } from "./types";

export const estimate: ResolverModule = {
  Query: {},
  Mutation: {
    /**
     * One serving of the typed Food: 7 nutrients plus the serving's grams, suggested units (and a
     * Yield ratio for an ingredient). The Food is also saved to the shared Library (spec story 38).
     */
    async estimate(ctx, { text, ingredient }) {
      const est = await estimateFood(text, { ingredient: ingredient === true });
      return { ...est, food: await addEstimatedFood(ctx.username, est) };
    },
  },
};
