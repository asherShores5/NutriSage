// Creates the two Members (USERNAMES in lib/stacks.ts) with a strong one-time password each, used
// once to sign in and add a passkey (Face ID). Passwords go to .secrets/initial-passwords.txt at the
// repo root (chmod 600, gitignored), never stdout. Run only after the anonymous-denial checks in
// docs/deploy-runbook.md pass.
// Usage (from infra/): AWS_PROFILE=personal npx tsx scripts/create-users.ts <userPoolId> [--reset]
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { USERNAMES } from "../lib/stacks";
import { oneTimePassword } from "./password";

const [poolId, flag] = process.argv.slice(2);
if (!poolId || !/^[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]+$/.test(poolId)) throw new Error("usage: create-users.ts <userPoolId> [--reset]");
// The pool ID starts with its region, so the dev desktop's global AWS_REGION can't misroute this.
const region = poolId.split("_")[0];
const cog = new CognitoIdentityProviderClient({ region });

async function exists(username: string) {
  try {
    await cog.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: username }));
    return true;
  } catch (e) {
    if ((e as Error).name === "UserNotFoundException") return false;
    throw e;
  }
}

async function main() {
  const lines: string[] = [];
  for (const username of USERNAMES) {
    const had = await exists(username);
    if (had && flag !== "--reset") {
      console.log(`${username}: exists, skipped (pass --reset to issue a new password)`);
      continue;
    }
    if (!had) await cog.send(new AdminCreateUserCommand({ UserPoolId: poolId, Username: username, MessageAction: "SUPPRESS" }));
    const pw = oneTimePassword();
    await cog.send(new AdminSetUserPasswordCommand({ UserPoolId: poolId, Username: username, Password: pw, Permanent: true }));
    lines.push(`${username}\t${pw}`);
    console.log(`${username}: ${had ? "password reset" : "created"}`);
  }

  if (lines.length) {
    const dir = path.join(__dirname, "..", "..", ".secrets");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, "initial-passwords.txt");
    writeFileSync(file, `# NutriSage one-time sign-in passwords (${new Date().toISOString()})\n${lines.join("\n")}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    console.log(`passwords written to ${file}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
