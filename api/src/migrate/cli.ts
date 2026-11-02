// The migration script (ticket 16). Dry run by default; writes only with --apply.
// Reads the old table (read-only Scan), finds the new table from the NutriSage stack's TableName
// output, and prints per-kind counts. See docs/cutover-runbook.md.
//
//   AWS_PROFILE=personal npx tsx api/src/migrate/cli.ts            # dry run
//   AWS_PROFILE=personal npx tsx api/src/migrate/cli.ts --apply    # write
//
// Options: --stack NutriSage --region us-west-1 (new) --old-table nutrisageai-data --old-region us-east-1
// Regions are set on each client, never taken from AWS_REGION (the dev desktop sets us-west-2).
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { DynamoDBClient, ScanCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { formatReport, migrate, type Target } from "./migrate";

export interface CliOptions {
  apply: boolean;
  stack: string;
  region: string;
  oldTable: string;
  oldRegion: string;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const o: CliOptions = { apply: false, stack: "NutriSage", region: "us-west-1", oldTable: "nutrisageai-data", oldRegion: "us-east-1" };
  const value = (i: number) => {
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${argv[i]} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") o.apply = true;
    else if (a === "--dry-run") o.apply = false;
    else if (a === "--stack") o.stack = value(i++);
    else if (a === "--region") o.region = value(i++);
    else if (a === "--old-table") o.oldTable = value(i++);
    else if (a === "--old-region") o.oldRegion = value(i++);
    else throw new Error(`unknown option ${a}`);
  }
  if (argv.includes("--apply") && argv.includes("--dry-run")) throw new Error("pick one of --apply and --dry-run");
  return o;
}

/** The new table's name from the stack output, or null when the stack isn't deployed. */
async function tableFromStack(stack: string, region: string): Promise<string | null> {
  const cfn = new CloudFormationClient({ region });
  try {
    const r = await cfn.send(new DescribeStacksCommand({ StackName: stack }));
    return r.Stacks?.[0]?.Outputs?.find((o) => o.OutputKey === "TableName")?.OutputValue ?? null;
  } catch (e) {
    if ((e as Error).name === "ValidationError" && /does not exist/.test((e as Error).message)) return null;
    throw e;
  }
}

async function scanOld(table: string, region: string): Promise<Record<string, AttributeValue>[]> {
  const db = new DynamoDBClient({ region });
  const out: Record<string, AttributeValue>[] = [];
  let ExclusiveStartKey: Record<string, AttributeValue> | undefined;
  do {
    const r = await db.send(new ScanCommand({ TableName: table, ConsistentRead: true, ExclusiveStartKey }));
    out.push(...(r.Items ?? []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

/** Stands in for a table that doesn't exist yet: empty, and refuses writes. Dry run only. */
const emptyTarget: Target = {
  table: "(not deployed)",
  db: {
    send: async (cmd: unknown) => {
      const name = (cmd as object).constructor.name;
      if (name === "GetCommand") return {};
      if (name === "QueryCommand") return { Items: [] };
      throw new Error("no target table to write to");
    },
  } as Target["db"],
};

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const table = await tableFromStack(o.stack, o.region);
  if (!table && o.apply) throw new Error(`stack ${o.stack} in ${o.region} has no TableName output: deploy it before --apply`);
  const target: Target = table
    ? { table, db: DynamoDBDocumentClient.from(new DynamoDBClient({ region: o.region }), { marshallOptions: { removeUndefinedValues: true } }) }
    : emptyTarget;
  const rows = await scanOld(o.oldTable, o.oldRegion);
  console.log(`old table ${o.oldTable} (${o.oldRegion}): ${rows.length} rows`);
  console.log(`new table ${target.table} (stack ${o.stack}, ${o.region})${table ? "" : ": not found, counts assume an empty table"}`);
  console.log(formatReport(await migrate(rows, target, { apply: o.apply })));
}

if (process.argv[1] && /migrate[\\/]cli\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(`migration stopped: ${(e as Error).message}`);
    process.exit(1);
  });
}
