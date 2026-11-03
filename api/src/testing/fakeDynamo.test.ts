import { PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";
import { FakeDocClient } from "./fakeDynamo";

const put = (Item: Record<string, unknown>, ConditionExpression: string, ExpressionAttributeValues = {}) =>
  new PutCommand({ TableName: "t", Item, ConditionExpression, ExpressionAttributeValues });

describe("fakeDynamo matches DynamoDB", () => {
  it("`<>` against a missing attribute is false", async () => {
    const db = new FakeDocClient();
    db.seed({ PK: "p", SK: "s" });
    await expect(db.send(put({ PK: "p", SK: "s", x: 1 }, "x <> :v", { ":v": 1 }))).rejects.toThrow("condition failed");
  });

  it("a transaction with one failed condition writes nothing", async () => {
    const db = new FakeDocClient();
    db.seed({ PK: "p", SK: "a" });
    const tx = new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: "t", Item: { PK: "p", SK: "a" }, ConditionExpression: "attribute_not_exists(SK)" } },
        { Put: { TableName: "t", Item: { PK: "p", SK: "b" } } },
      ],
    });
    await expect(db.send(tx)).rejects.toMatchObject({
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
    });
    expect(db.dump().map((r) => r.SK)).toEqual(["a"]);
  });

  it("Select COUNT returns a Count and no Items", async () => {
    const db = new FakeDocClient();
    db.seed({ PK: "p", SK: "X#1" }, { PK: "p", SK: "X#2" }, { PK: "p", SK: "Y#1" });
    const r = await db.send(
      new QueryCommand({
        TableName: "t", KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues: { ":pk": "p", ":p": "X#" }, Select: "COUNT",
      }),
    );
    expect(r).toEqual({ Count: 2, LastEvaluatedKey: undefined });
  });

  it("transaction Updates count with if_not_exists and are refused together", async () => {
    const db = new FakeDocClient();
    const bump = (SK: string, cap: number) => ({
      Update: {
        TableName: "t", Key: { PK: "p", SK },
        UpdateExpression: "SET #n = if_not_exists(#n,:zero) + :one, e = :e",
        ConditionExpression: "attribute_not_exists(#n) OR #n < :cap",
        ExpressionAttributeNames: { "#n": "count" }, ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":cap": cap, ":e": 9 },
      },
    });
    await db.send(new TransactWriteCommand({ TransactItems: [bump("a", 1), bump("b", 5)] }));
    expect(db.dump()).toEqual([{ PK: "p", SK: "a", count: 1, e: 9 }, { PK: "p", SK: "b", count: 1, e: 9 }]);
    await expect(db.send(new TransactWriteCommand({ TransactItems: [bump("a", 1), bump("b", 5)] }))).rejects.toMatchObject({
      name: "TransactionCanceledException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
    });
    expect(db.dump().map((r) => r.count)).toEqual([1, 1]);
  });
});
