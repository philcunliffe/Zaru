# Zaru - Secure AI Chatbot PoC

> Named after the **Sanzaru** (三猿) - the three wise monkeys: "see no evil, hear no evil, speak no evil." The security architecture mirrors this principle: READ agents see content but can't act, WRITE agents act but can't see content, and the orchestrator routes but can't read content.

A proof-of-concept AI assistant that mitigates prompt injection attacks using an isolated agent architecture with strict permission boundaries.

## Core Security Principle: "Rule of Two"

An agent should never simultaneously have:
- **(A)** Processing untrusted inputs
- **(B)** Accessing sensitive data
- **(C)** Changing state

This is enforced through:
- **READ-only agents**: Process potentially hazardous content (emails, external data) but CANNOT write
- **WRITE-only agents**: Execute actions but only receive encrypted, pre-processed content
- **Orchestration agent**: Routes encrypted packages but CANNOT read their content

## Architecture

```
                         +--------+
                         |  USER  |
                         +---+----+
                             |
              +--------------+--------------+
              |    ORCHESTRATION AGENT      |
              |  - Creates plans            |
              |  - Routes encrypted pkgs    |
              |  - CANNOT read content      |
              +--------------+--------------+
                             |
         +-------------------+-------------------+
         |                                       |
+--------+--------+                   +----------+-------+
| READ-ONLY AGENTS |                   | WRITE-ONLY AGENTS |
| - EmailReader    |                   | - GDocsWriter     |
| Process hazardous|                   | Receive encrypted |
| content, encrypt |                   | content, execute  |
| output           |                   | actions           |
+------------------+                   +-------------------+
```

## Security Features

1. **Sealed Box Encryption**: Sub-agents encrypt output using NaCl sealed boxes - the orchestrator passes but cannot read
2. **Integrity Proofs**: Cryptographic proofs link agent output to the original user request
3. **Worker Isolation**: Each agent runs in a separate Bun Worker thread
4. **Permission Enforcement**: Workers enforce READ-only or WRITE-only permissions

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- OpenAI API key

### Installation

```bash
# Install dependencies
bun install
```

### Running

```bash
# Set your OpenAI API key
export OPENAI_API_KEY="your-key-here"

# Start the CLI
bun start
```

### Commands

Once in the chat interface:
- `/help` - Show available commands
- `/packages` - List received encrypted packages
- `/decrypt` - Decrypt and display the latest package
- `/decrypt <id>` - Decrypt a specific package
- `/clear` - Clear the screen
- `/quit` - Exit

### Example Request

```
You: Summarize my last 10 emails and write to Google Doc
```

This will:
1. Create an execution plan
2. Delegate to EmailReader (READ agent) to summarize emails
3. EmailReader encrypts output for GDocsWriter and user
4. Route encrypted package to GDocsWriter (WRITE agent)
5. Send encrypted confirmation to user
6. User can decrypt to verify content with integrity proof

## Development

### Project Structure

```
src/
├── index.ts                    # CLI entry point
├── cli/
│   ├── chat.ts                 # Interactive chat REPL
│   ├── approval.ts             # Approval prompts in terminal
│   └── encrypted-display.ts    # Secure content display
├── agents/
│   ├── orchestration.ts        # Main orchestration agent
│   ├── types.ts                # Shared agent interfaces
│   ├── llm.ts                  # LLM provider abstraction
│   └── workers/
│       ├── base-worker.ts      # Worker template with permission enforcement
│       ├── email-reader.ts     # Email read agent
│       └── gdocs-writer.ts     # Google Docs write agent
├── crypto/
│   ├── sealed-box.ts           # Sealed box encryption
│   ├── keys.ts                 # Key management
│   └── integrity.ts            # Proof generation/verification
├── services/
│   ├── approval.ts             # User approval queue
│   └── package-router.ts       # Encrypted package routing
└── mocks/
    ├── email.ts                # Mock email data
    └── gdocs.ts                # Mock Google Docs responses
```

### Running Tests

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch
```

### Type Checking

```bash
bun run typecheck
```

## Technology Stack

- **Runtime**: Bun
- **AI SDK**: Vercel AI SDK 4.x
- **LLM Provider**: OpenAI (GPT-4o, GPT-4o-mini)
- **Encryption**: TweetNaCl (sealed boxes)
- **Process Isolation**: Bun Worker Threads

## Security Tests

The test suite includes specific security tests that verify:
- Orchestrator cannot decrypt agent-to-agent communication
- READ agents cannot have write permissions
- WRITE agents only receive encrypted content
- Integrity proofs detect tampering
- Permission boundaries are enforced
