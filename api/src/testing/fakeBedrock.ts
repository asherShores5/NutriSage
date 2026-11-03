// Stand-in for the Bedrock runtime client: answers ConverseCommand with a scripted reply (or
// error) and records what was asked, so tests never call AWS. Installed by harness.ts.
import { ConverseCommand, type ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";

export class FakeBedrock {
  /** Every Converse request, oldest first. */
  calls: ConverseCommandInput[] = [];
  private next: { text: string } | { error: Error } = { text: "{}" };

  /** The model's next reply text. */
  reply(text: string) {
    this.next = { text };
  }

  /** Make the next call throw, like a throttle or access-denied error. */
  fail(error: Error) {
    this.next = { error };
  }

  reset() {
    this.calls = [];
    this.next = { text: "{}" };
  }

  /** The text of the last user message sent to the model. */
  lastPrompt(): string {
    const c = this.calls.at(-1);
    return (c?.messages?.at(-1)?.content ?? []).map((b) => ("text" in b ? b.text : "")).join("");
  }

  async send(cmd: unknown): Promise<unknown> {
    if (!(cmd instanceof ConverseCommand)) throw new Error("FakeBedrock supports only ConverseCommand");
    this.calls.push(cmd.input);
    if ("error" in this.next) throw this.next.error;
    return { output: { message: { role: "assistant", content: [{ text: this.next.text }] } }, stopReason: "end_turn" };
  }
}
