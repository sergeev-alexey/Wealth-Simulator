# Wealth Simulator — evaluating the Gemini Interactions API

A multi-turn financial-planning assistant built to evaluate the **Interactions API's stateful-conversation + server-side context-management capability**. It ingests a household's assets and cash flows, runs a 10,000-path Monte Carlo projection, and returns a grounded FIRE analysis with P5/P50/P95 bands.

## Why this capability
Stateful, multi-turn agent workloads are where statefulness becomes a platform moat. This app stress-tests that surface on a realistic use case rather than a toy.

## Architecture
- **Client (React/Vite) → Express proxy (server.ts) → Gemini Interactions API.** API key stays server-side.
- **Statefulness** via `previous_interaction_id` (history is not re-sent each call).
- **Local Monte Carlo** runs in Node, not via Gemini Code Execution — deliberately, to sidestep Code Execution availability/quota limits on newer models (see friction log).
- **Grounded narration**: the model emits typed parameters, the engine computes real results, and a second call narrates strictly from those numbers — preventing the model from fabricating financial figures.
- **Client-side context tracking**: the API exposes only raw token counts, so context-fill % is tracked manually.

## Dev toggles (to reproduce friction)
Prefix any chat message:
- `model:<id>` — override the model (e.g. `model:gemini-2.5-flash`)
- `mode:tool` — native function calling instead of local JSON parsing
- `dropconfig:on` — omit system_instruction on a follow-up turn (tests what `previous_interaction_id` carries)
- `pad:<N>` — inject ~N tokens to exercise the context budget
