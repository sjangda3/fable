# Provider connections

Fable uses separately installed official runtimes and their authentication. It does not read, copy, or synchronize provider token files. API-key and alternate-cloud environment variables are removed from the child environment to avoid silently changing billing methods.

## Codex

The adapter starts `codex app-server` over stdio, performs initialization, calls `account/read` and `model/list`, and creates an ephemeral read-only thread for each request. The tested runtime is 0.162.1. Shell, unified exec, apps, MCP configuration, plugins, subagents, image tools, and web search are disabled by explicit child-process configuration. Server-initiated approval and tool requests fail closed. The working directory is a disposable empty staging folder, never the vault.

The current app-server no longer accepts the legacy `readOnly.access` restriction object. Fable uses its supported read-only policy with network access disabled for tools. Inference itself remains a provider connection. See [Codex app-server](https://learn.chatgpt.com/docs/app-server) and [permission profiles](https://learn.chatgpt.com/docs/permissions).

## Claude

The adapter uses the Claude Agent SDK with `pathToClaudeCodeExecutable` pointing at the detected runtime. It supplies no tools, denies tool permission requests, enables strict empty MCP configuration, loads no user/project settings or plugins, and runs in an empty staging folder. Model discovery initializes an empty input stream without inference.

The tested installed runtime is Claude Code 2.1.128. It reports OAuth authentication and five models, but the actual inference check returned an expired/revoked OAuth login. Fable must show that as an authentication failure and offer the runtime's sign-in flow; catalog discovery alone is not proof of inference access.

The SDK's package and runtime have their own licenses and distribution rules. Public distribution of this subscription integration remains an explicit release gate. Verify current eligibility against [Claude plan guidance](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) and [Agent SDK documentation](https://code.claude.com/docs/en/agent-sdk/overview). The runtime is not bundled as part of Fable's original MIT code.

## Review boundary

Only selected documents are sent, with IDs, exact raw content, and base revisions. The response schema contains a message and proposed document replacements. The adapter rejects changes outside the selected IDs or revisions. Proposals do not perform writes. The renderer shows affected files and before/after text; Apply invokes the guarded vault service. Local history supports undo. Rejecting leaves source notes untouched.

The prompt, successful response, failure, partial output, and proposal are saved as Markdown. Existing entitlements, model availability, network conditions, authentication, and quotas still govern each request. Health discovery and inference are separate checks.
