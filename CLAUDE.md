# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zaru is a TypeScript/Bun proof-of-concept secure AI chatbot implementing an isolated agent architecture to mitigate prompt injection attacks. Named after the Sanzaru (三猿) - the three wise monkeys - reflecting the security principle where agents are isolated: see no evil (READ agents process but can't act), hear no evil (WRITE agents act but only receive encrypted content), speak no evil (orchestrator routes but can't read). It demonstrates the "Rule of Two" security principle where an agent should never simultaneously have: (A) processing untrusted inputs, (B) accessing sensitive data, and (C) changing state.

## Commands

```bash
bun start           # Start the CLI interactive chat
bun dev             # Start in watch mode
bun test            # Run all tests
bun test --watch    # Run tests in watch mode
bun run typecheck   # TypeScript type checking
```

Run a single test file:
```bash
bun test tests/crypto.test.ts
```

## Architecture

### Agent Permission Model

Agents are classified by permission type enforced at initialization:
- **READ**: Process content (all treated as potentially dangerous), produce encrypted output, no write capability. Receive hardened security prompts.
- **WRITE**: Execute actions, only receive pre-encrypted content
- **READ_WRITE**: Both read and write (e.g., browser agent)
- **Orchestrator**: Routes encrypted packages but cannot decrypt content

### Encrypted Communication Flow

1. User intent extracted BEFORE content decryption (prevents manipulation)
2. READ agents process content and encrypt output using TweetNaCl sealed boxes
3. Orchestrator routes encrypted packages without decryption ability
4. WRITE agents receive and process pre-encrypted content
5. User can verify content with cryptographic integrity proofs

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Orchestrator | `src/agents/orchestration.ts` | Creates execution plans, validates intent, routes packages |
| Workers | `src/agents/workers/` | Permission-enforced agents with base class pattern |
| Intent System | `src/agents/intent.ts` | Intent extraction, validation, permission tracking |
| Crypto | `src/crypto/` | Sealed box encryption, key management, integrity proofs |
| Sandbox | `src/sandbox/` | Security scanning, schema validation, threat detection |

### Execution Plans

Multi-step plans with step types:
- `delegate`: Route to READ agent
- `route`: Route to WRITE agent
- `approve`: Request user approval
- `respond`: Direct response
- `gather`: Collect information

### Escalation System

Workers can escalate to orchestrator for decisions. User can approve, deny, or respond directly. Escalations have timeout support (default 5 minutes).

## Technology Stack

- Runtime: Bun 1.0+
- AI SDK: Vercel AI SDK with OpenAI (GPT-4o)
- Encryption: TweetNaCl sealed boxes
- Validation: Zod
- Process Isolation: Bun Worker Threads
