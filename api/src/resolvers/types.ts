/** Who is calling: an allowlisted Member, checked by the handler before any resolver runs. */
export interface Ctx {
  userId: string;
  username: string;
}

export type Resolver = (ctx: Ctx, args: Record<string, unknown>) => Promise<unknown>;

/** One entity's resolvers, by GraphQL root type. Field names match the schema/<entity>.graphql file. */
export interface ResolverModule {
  Query: Record<string, Resolver>;
  Mutation: Record<string, Resolver>;
}
