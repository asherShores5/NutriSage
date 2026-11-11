// The Member password rules, mirroring the user pool's policy (infra/lib/stacks.ts passwordPolicy),
// so the Profile form can say what's wrong before Cognito does.
export const PASSWORD_MIN_LENGTH = 16;

/** Why a new password would be refused, or undefined when it's fine. */
export function passwordProblem(password: string, confirm: string, current: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/[a-z]/.test(password)) return "Add a lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Add an uppercase letter.";
  if (!/[0-9]/.test(password)) return "Add a number.";
  if (password === current) return "Pick a password different from your current one.";
  if (password !== confirm) return "The two new passwords don't match.";
  return undefined;
}
