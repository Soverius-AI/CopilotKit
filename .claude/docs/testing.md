# Testing & debugging — discussion summary

Notes from a design discussion (Angular demo, cross-framework parity, agent fakes, and observability). This is not official product documentation; it captures decisions and options explored.

## Observability: seeing agent ↔ model traffic

### What “messages” means in CopilotKit

| Layer                | Where to look                                                                        | What you get                                                                          |
| -------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **Client → runtime** | Browser Network → POST `.../api/copilotkit/agent/<id>/run` → request body `messages` | AG-UI `Message[]` sent for that run                                                   |
| **Runtime → client** | Same response (SSE) or events `MESSAGES_SNAPSHOT`                                    | Full thread snapshot on the wire                                                      |
| **Client state**     | `injectAgentStore().messages` or `copilotkit.getAgent(id).messages`                  | Merged thread after the client processes events                                       |
| **Server logs**      | `CopilotRuntime({ debug: { events: true, lifecycle: true, verbose: true } })`        | Structured Pino logs; `verbose: true` required for full payloads (not just summaries) |
| **VS Code**          | CopilotKit extension → “Open AG-UI Inspector”; connect to runtime URL                | Live AG-UI event stream in dev (`/cpk-debug-events` when `NODE_ENV !== production`)   |

`debug: true` alone logs identifiers and lengths, not full message bodies.

Angular `provideCopilotKit` does not expose `debug` yet; workarounds: `inject(CopilotKit).core.setDebug(...)`, Network tab, or server-side debug on [demo-server](examples/v2/angular/demo-server/src/index.ts).

### Persisting communication to disk (one file per session)

Discussed but not implemented. Intended shape:

- **Session key:** `threadId` (e.g. a2ui demo tabs `thread---a` / stateless with client-generated id).
- **Server-side:** `afterRequestMiddleware` (reconstructed messages from SSE), `debugEventBus` subscription (every AG-UI event), and/or logging run POST bodies.
- **Format:** JSONL append per thread under a configurable directory (e.g. env `COPILOTKIT_SESSION_LOG_DIR`), dev-only.

Distinct from test fakes; this is for local debugging/replay of real runs.

---

## Agent fakes for tests

### In-process: `MockStepwiseAgent` (today)

Canonical pattern for **CopilotChat-style** tests: subclass `AbstractAgent`, `run()` returns a shared RxJS `Subject`, tests call `emit()` / `complete()` with AG-UI events step-by-step.

| Location                                                                                                                   | Role                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [packages/react-core/src/v2/**tests**/utils/test-helpers.tsx](packages/react-core/src/v2/__tests__/utils/test-helpers.tsx) | React: sync `emit` wrapped in `act()`; event factories (`runStartedEvent`, `textChunkEvent`, …); `renderWithCopilotKit` |
| [packages/vue/src/v2/**tests**/utils/test-helpers.ts](packages/vue/src/v2/__tests__/utils/test-helpers.ts)                 | Vue: async `emit`, buffering before subscribe, richer `clone()` — **superset** of React                                 |
| [packages/angular/src/lib/agent.spec.ts](packages/angular/src/lib/agent.spec.ts)                                           | Lighter `MockAgent` for `injectAgentStore` / subscriptions only (no stepwise SSE)                                       |
| [packages/demo-agents](packages/demo-agents)                                                                               | `SlowToolCallStreamingAgent` — scripted demo agent, not a shared test utility                                           |

Reference e2e suite: [CopilotChat.e2e.test.tsx](packages/react-core/src/v2/components/chat/__tests__/CopilotChat.e2e.test.tsx) (~1200 lines).

[packages/angular/AGENTS.md](packages/angular/AGENTS.md) recommends porting the React/Vue **in-process** pattern first, **not Playwright** initially.

### Why `MockStepwiseAgent` is not shared yet

- Lives inside per-framework test helpers next to `renderWithCopilotKit` (framework-specific mounting).
- Vue and React implementations **diverged** (scheduling, buffering, clone semantics).
- Some React specs still **inline** their own `MockStepwiseAgent` subclass.
- No `@copilotkit/test-agents` (or similar) private package exists today.

The **portable** core (subject + `run()` + shared event builders) can be extracted; only **UI flush** stays per framework (`act`, `nextTick`, `fixture.detectChanges`).

### Playwright + route fixture (alternative)

Intercept `**/api/copilotkit/**` and fulfill SSE + `/info` with scripted AG-UI events.

| Pros                                                  | Cons                                                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real browser, real `provideCopilotKit`, CORS, routing | Slower, more moving parts                                                                                                                           |
| Good for smoke / wiring                               | `route.fulfill` is one-shot — poor for progressive chunk tests unless a streaming mock server is added                                              |
|                                                       | Showcase harness uses CDP for SSE **observation**, not stepwise mock ([sse-interceptor.ts](showcase/harness/src/probes/helpers/sse-interceptor.ts)) |

Does not replace in-process `MockStepwiseAgent` for parity with React chat e2e tests.

### aimock — LLM-layer fake ([github.com/CopilotKit/aimock](https://github.com/CopilotKit/aimock))

Separate concern: mocks **OpenAI / Anthropic / Gemini** HTTP (including SSE), not AG-UI directly.

- Fixtures: JSON with `match.userMessage` (substring), optional `context` / `toolName`; response `content`, `toolCalls`, etc.
- Showcase: [showcase/aimock/README.md](showcase/aimock/README.md); `OPENAI_BASE_URL=http://aimock:4010/v1` on agents using `BuiltInAgent`.
- **Framework-agnostic at the provider boundary** — React, Vue, Angular demos all benefit if the runtime points at aimock.
- Does **not** prove CopilotChat handles `TEXT_MESSAGE_CHUNK` the same way across frameworks (that’s `MockStepwiseAgent` / test-agents).
- Angular [demo-server](examples/v2/angular/demo-server/src/index.ts) today uses real keys (OpenRouter/OpenAI); aimock is an optional full-stack dev/CI lane.

---

## Proposed direction: shared `@copilotkit/test-agents`

Plan: [shared_test_agent_fake](.cursor/plans/shared_test_agent_fake_eac408ed.plan.md) (local Cursor plan).

### Goal

One canonical **AG-UI** fake + event factories for React, Vue, and Angular Vitest, so the **same event scripts** drive parity tests.

```text
@copilotkit/test-agents (private)
  ├── event factories (runStartedEvent, textChunkEvent, …)
  ├── MockStepwiseAgent + MockReconnectableAgent
  └── EmitScheduler hook (sync default)

Per framework (thin):
  ├── react-core/testing  → act()
  ├── vue/testing         → nextTick + buffer
  └── angular/testing     → detectChanges / fakeAsync
```

`renderWithCopilotKit` stays in each package.

### Two-layer testing strategy

| Layer                | Tool                      | Guarantees                                                         |
| -------------------- | ------------------------- | ------------------------------------------------------------------ |
| **AG-UI / UI**       | `@copilotkit/test-agents` | Same protocol events → same CopilotChat behavior across frameworks |
| **LLM / full stack** | aimock (optional)         | Deterministic model responses for real `BuiltInAgent` + runtime    |

Avoid maintaining every scenario in **both** aimock JSON and AG-UI event arrays; use test-agents for UI parity, aimock for smoke/full-stack.

### Migration order (planned)

1. Scaffold private `packages/test-agents` + self-tests.
2. Extract from Vue test-helpers (reference implementation).
3. Migrate React and Vue imports; remove duplicate class bodies.
4. Angular: `__tests__/utils` + subset of `CopilotChat.e2e` scenarios.
5. Optional: aimock wiring for `examples/v2/angular/demo-server` + Playwright smoke.
6. Optional: `encodeAgUiSseStream` for Playwright route mocks; shared scenario JSON files.

### Governance

- New package `packages/test-agents` is **outside** Soverius `packages/angular/**`-only write scope — needs upstream PR.
- Angular test port can proceed once the dependency exists.

---

## Quick reference: which tool when

| Need                                       | Use                                                              |
| ------------------------------------------ | ---------------------------------------------------------------- |
| Debug raw messages in dev                  | Network tab + server `debug.verbose` + AG-UI Inspector           |
| Persist session to disk                    | Not built; middleware + `threadId` files (discussed)             |
| React/Vue/Angular CopilotChat parity       | Shared `MockStepwiseAgent` / `@copilotkit/test-agents` (planned) |
| Angular store / `injectAgentStore`         | Existing `MockAgent` in `agent.spec.ts`                          |
| Full stack, real BuiltInAgent, no API keys | aimock + fixtures                                                |
| Browser smoke, real UI + runtime           | Playwright + aimock (or rare SSE route mock)                     |
| Stepwise streaming/tool/HITL UI tests      | Vitest + in-process mock, not aimock alone                       |

---

## Related files

- [packages/angular/AGENTS.md](packages/angular/AGENTS.md) — test depth priorities
- [docs/snippets/shared/troubleshooting/debug-mode.mdx](docs/snippets/shared/troubleshooting/debug-mode.mdx) — debug mode
- [showcase/aimock/README.md](showcase/aimock/README.md) — aimock fixtures
- [.claude/skills/showcase-demo-debugging/SKILL.md](.claude/skills/showcase-demo-debugging/SKILL.md) — showcase + aimock workflow
