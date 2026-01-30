# Debug Logs

Check the latest Zaru session logs to find and fix issues.

## Instructions

1. List the log sessions in `~/.zaru/logs/` sorted by most recent
2. From the most recent session, read:
   - `error.log` for exceptions and stack traces
   - `permissions.jsonl` for security blocks or warnings
   - `chat.jsonl` if message flow context is needed
3. Analyze any errors or security blocks and identify the root cause
4. Search the codebase to find the relevant source code
5. Propose a fix for any issues found

## Log File Locations

- Session logs directory: `~/.zaru/logs/<session-id>/`
- Error log: `error.log` - Plain text file with timestamped errors and stack traces
- Chat log: `chat.jsonl` - JSONL file with all agent messages
- Permissions log: `permissions.jsonl` - JSONL file with permission and security checks

## Context

The logger service is defined in `src/services/logger.ts`. It creates per-session log directories with:
- A unique session ID based on timestamp and random string
- An error.log for exceptions with stack traces
- A chat.jsonl for message history
- A permissions.jsonl for security audit trail

### Permission Log Entry Types

The permissions log tracks these events:
- `intent_extraction` / `intent_validation` - User intent processing
- `step_validation` / `tool_validation` - Execution plan validation
- `permission_check` - Agent permission verification
- `agent_registration` - New agent registration
- `package_routing` - Encrypted package routing
- `escalation_request` / `escalation_response` - Escalation handling
- `user_approval` - User approval events
- `content_share` - Content sharing between agents
- `security_warning` / `security_block` - Security events (check these for issues)
