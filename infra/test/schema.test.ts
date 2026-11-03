// The GraphQL schema is split per entity (schema/*.graphql) and composed into one document for
// AppSync and the e2e fake backend. AppSync rejects a bad schema only at deploy, so check it here.
import { buildSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { composeSchema, composeSchemaDir, rootFields } from "../../schema/compose";

/** Scalars and directives AppSync supplies; graphql-js needs them declared. */
const APPSYNC_PRELUDE = "scalar AWSJSON\nscalar AWSDate\ndirective @aws_subscribe(mutations: [String]) on FIELD_DEFINITION\n";

describe("schema composition", () => {
  it("folds each file's `extend type Query/Mutation` into one Query and one Mutation type", () => {
    const sdl = composeSchema([
      "schema { query: Query mutation: Mutation }\ntype Query\ntype Mutation",
      "# placeholder file with no definitions yet",
      "type Thing { id: ID! }\nextend type Query { things: [Thing!]! }\nextend type Mutation { putThing(id: ID!): Thing! }",
      "extend type Query { thing(id: ID!): Thing }",
    ]);
    expect(sdl).not.toMatch(/\bextend\b/);
    expect(rootFields(sdl)).toEqual({ Query: ["things", "thing"], Mutation: ["putThing"] });
    expect(() => buildSchema(APPSYNC_PRELUDE + sdl)).not.toThrow();
  });

  it("refuses the same root field in two files", () => {
    expect(() => composeSchema(["type Query", "extend type Query { a: Int }", "extend type Query { a: Int }"])).toThrow(/Query\.a/);
  });

  it("the repo's schema/ composes into a valid schema with the Day API", () => {
    const sdl = composeSchemaDir();
    expect(() => buildSchema(APPSYNC_PRELUDE + sdl)).not.toThrow();
    const fields = rootFields(sdl);
    expect(fields.Query).toContain("days");
    expect(fields.Mutation).toContain("putDay");
  });
});
