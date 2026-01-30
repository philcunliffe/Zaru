/**
 * Zaru - Secure AI Chatbot PoC
 *
 * Named after the Sanzaru (三猿) - the three wise monkeys.
 * Entry point for the isolated agent architecture demo.
 * Implements the "Rule of Two" security principle for AI assistants.
 */

import { runChat } from "./cli/chat";

/**
 * Parse command line arguments
 */
function parseArgs(): { logEnabled: boolean } {
  const args = process.argv.slice(2);
  const logEnabled = args.includes("--log") || args.includes("-l");
  return { logEnabled };
}

async function main(): Promise<void> {
  try {
    const options = parseArgs();
    await runChat(options);
  } catch (error) {
    console.error(
      "Fatal error:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

main();
