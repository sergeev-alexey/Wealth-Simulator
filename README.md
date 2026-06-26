# Wealth Simulator
 
An AI-assisted Monte Carlo wealth and FIRE (Financial Independence, Retire Early) simulator built on the Google Gemini Interactions API.
 
Describe your household finances in plain language. The app extracts the parameters, runs a 10,000-path Monte Carlo projection locally, and returns a grounded analysis: P5 / P50 / P95 wealth bands and the probability of reaching financial independence over time.
 
> **Status:** early prototype with a deliberately minimal UI. The focus is the simulation engine and the API integration, not the chrome. I plan to grow this into a full-featured personal finance tool.
 
> **Disclaimer:** this is a simplified model for exploration, not financial advice.
 
---
 
## Contents
- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [The Monte Carlo engine](#the-monte-carlo-engine)
- [Grounded narration](#grounded-narration)
- [Developer hooks (control tokens)](#developer-hooks-control-tokens)
- [Design decisions](#design-decisions)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Configuration](#configuration)
- [Limitations and modeling assumptions](#limitations-and-modeling-assumptions)
---
 
## What it does
 
The interface is a chat on the left and a chart on the right. You provide a "ground truth" (family, location, assets, debts, income, expenses) and then a scenario to model, for example "when can we fully retire?". The assistant gathers the inputs conversationally, then triggers a simulation. The chart renders the projected wealth distribution over time, and the assistant explains the result using numbers the engine actually computed.
 
The conversation is stateful: prior turns are held server-side via the Interactions API, so the full history is not resent on every request.
 
## How it works
 
Request flow:
 
```
Browser (React + Vite)
   |
   v
Express proxy  (server.ts)        <-- holds the API key, runs the simulation
   |
   v
Gemini Interactions API
```
 
- **The API key stays server-side.** The browser only talks to the Express proxy; it never sees the key.
- **Statefulness** comes from `previous_interaction_id`. Each turn references the previous interaction instead of resending the transcript.
- **The model's job is narrow:** extract structured parameters from natural language, and narrate results. The numeric work runs in Node.
- **Two execution paths** are supported (see [control tokens](#developer-hooks-control-tokens)): a tool path using native function calling (the default), and a local path where the model emits a JSON parameter block the server parses.
## The Monte Carlo engine
 
The engine lives in `runMonteCarlo` in `server.ts`.
 
- **10,000 paths**, with a horizon clamped between 5 and 50 years.
- **Real-terms model.** For each year, real growth is drawn as `(1 + stockGrowth) / (1 + inflation) - 1`, where `stockGrowth` and `inflation` are sampled from independent normals via a Box-Muller transform, then annual savings are added.
- **One pass per path.** Each path is simulated once across all years (O(paths x years)). Per year, the engine sorts the current wealth across paths and records the 5th, 50th, and 95th percentiles, plus the share of paths at or above the FIRE target.
- **FIRE metric.** The target is `annualExpenses / withdrawalRate` (for example 25x expenses at a 4% rate). The reported FIRE year is the first year in which at least 85% of paths clear the target, which is intentionally a confidence-based date rather than the median.
A full 50-year, 10,000-path run completes in well under 100ms, so end-to-end latency is dominated by the model call, not the math.
 
## Grounded narration
 
A naive approach would let the model emit the parameters and the written conclusion in a single response. The problem is that the response is generated before the engine has run, so any numbers in it are invented.
 
This project avoids that. The flow is:
 
1. The model produces the simulation parameters (by calling the `run_monte_carlo` tool, or by emitting a JSON block in the local path).
2. The engine computes the real results.
3. The results are sent back to the model, which writes the explanation **strictly from the computed numbers**.
The result is a narrative whose figures match the chart, because both come from the same engine output.
 
## Developer hooks (control tokens)
 
You can prefix any chat message with these tokens. They are parsed and stripped server-side before the message reaches the model. They exist for experimentation and debugging while building against the Interactions API.
 
| Token | Effect |
| :-- | :-- |
| `mode:tool` *(default)* | Native function calling. The model calls a typed `run_monte_carlo` tool; the result is returned and narrated. |
| `mode:local` | The model emits a fenced `simulationParams` JSON block. The server parses it, runs the engine, then makes a second call to narrate the results. |
| `model:<id>` | Overrides the model for that request, e.g. `model:gemini-2.5-flash`. Default is `gemini-3.1-flash-lite`. |
| `dropconfig:on` | On a follow-up turn, sends only `previous_interaction_id` and omits the system instruction and tools. Useful for inspecting exactly what server-side state carries across turns. |
| `pad:<N>` | Prepends roughly `N` filler tokens to the input, to exercise the context-tracking and budget logic. |
 
Examples:
 
```
mode:local model:gemini-2.5-flash When can this household retire?
pad:20000 continue
```
 
Each reply also appends a `[Session Context Consumed: X%]` line and, when a non-default token is used, a `[path: ... | model: ...]` indicator.
 
## Design decisions
 
This section documents what the project deliberately does **not** do, and why.
 
### Local computation instead of Gemini Code Execution
 
Gemini offers a built-in Code Execution tool that runs Python in a server-side sandbox. This project runs the Monte Carlo locally in Node instead. Reasons:
 
- **Determinism and control** over the financial model and its numerics.
- **Speed.** The workload is tiny (sub-100ms), so a sandbox round-trip would add latency for no benefit.
- **No dependency** on Code Execution availability or quota.
- **A narrow model role.** The model extracts parameters and narrates; it does not compute. That keeps results reproducible and easy to reason about.
### Grounded two-call flow instead of single-shot narration
 
As described above, the model narrates only after the engine has produced real numbers. The extra round-trip is a deliberate trade: more latency and token usage, in exchange for figures that are never fabricated. This matters for a finance tool where a confidently wrong number is worse than a slower answer.
 
### Client-side context tracking
 
The Interactions API exposes per-call token counts but no server-side context-fill telemetry, budget, or compaction. So the app tracks usage itself: it sums tokens across turns (the per-call counts are not cumulative, so the running total is carried on the client and passed back each request), shows a context-consumed percentage, and raises a local budget warning when a configurable threshold is crossed.
 
### Automatic SDK retries disabled
 
The Gemini client is constructed with a single attempt and no automatic retries. Retrying a side-effecting call (one that ran a tool) without an idempotency key is not safe, and on a rate-limited tier automatic retries make things worse by spending more of the same quota. Retry policy, if any, is left to the application.
 
### No built-in grounding tools
 
Search and Maps grounding are not used. The use case is self-contained numeric modeling, so external grounding adds nothing here.
 
### Model metadata is cached
 
Per-model token limits are fetched once and cached (and pre-warmed at startup) rather than fetched on every request.
 
## Tech stack
 
- **Frontend:** React 19, Vite, Tailwind CSS, Recharts, react-markdown
- **Backend:** Node, Express, TypeScript, `@google/genai` (Gemini Interactions API)
- **Build:** Vite for the client, esbuild for the server bundle
## Project structure
 
```
server.ts          Express proxy, Interactions API calls, Monte Carlo engine, token parsing
src/App.tsx        Chat UI, chart rendering, cumulative-token bookkeeping
src/main.tsx       React entry point
index.html         App shell
vite.config.ts     Vite + Tailwind config
.env.example       Required environment variables
```
 
## Configuration
 
- `GEMINI_API_KEY` (required): your Gemini API key.
- **Default model:** `gemini-3.1-flash-lite`. Override per message with `model:<id>`.
- **Engine constants** (top of `server.ts`): `LOOPS`, `MIN_YEARS`, `MAX_YEARS`, `FIRE_THRESHOLD`, `DEFAULT_WITHDRAWAL_RATE`.
- **Context budget:** `CONTEXT_BUDGET_PCT` controls when the context warning fires.
## Limitations and modeling assumptions
 
This is a simplified model. Known simplifications:
 
- Wealth grows in **real terms**, and annual savings are added as a flat real amount each year.
- The FIRE target uses a **static safe-withdrawal-rate rule** (for example 4%, i.e. 25x expenses).
- **Account types are not modeled.** Tax-advantaged vs taxable balances, taxes on withdrawal, and early-withdrawal penalties are out of scope, which matters for early retirement.
- **Real estate, rental income, and mortgage amortization** are not separately modeled beyond whatever figures you provide.
- Stock returns and inflation are **independent normals**; correlations and fat tails are not captured.
- The UI is intentionally minimal and not optimized for mobile.
 

