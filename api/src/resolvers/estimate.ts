// Bedrock nutrition estimates for Members (spec: Estimates). Schema: schema/estimate.graphql.
// The work is in ../estimate.ts, which the Guest endpoint (ticket 10) reuses with its own caps.
import { estimateFood } from "../estimate";
import type { ResolverModule } from "./types";

export const estimate: ResolverModule = {
  Query: {},
  Mutation: {
    /** One serving of the typed Food: 7 nutrients plus the serving's grams (and a Yield ratio for an ingredient). */
    async estimate(_ctx, { text, ingredient }) {
      return estimateFood(text, { ingredient: ingredient === true });
    },
  },
};
