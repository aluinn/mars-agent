---
title: "Implement an LLM planner behind the Planner interface"
labels: ["enhancement"]
---

## Context

The decision layer is pluggable. `Planner.decide()` in `src/agent/planner.ts` may return a decision or a promise, and `Agent` already applies an asynchronous decision without blocking the simulation (the `pending` handling in `src/agent/agent.ts`). Today the only implementation is the rule and utility planner in `src/agent/utilityPlanner.ts`. Nothing calls an LLM yet, and no API key is involved.

## Task

Add an `LlmPlanner` that sends a compact text summary of the `Observation` to a Vercel serverless function (`api/plan.ts`), which calls a model and returns one of the existing `Decision` kinds. Requirements:

- The browser never sees an API key. All keys live in the function's environment variables.
- The prompt contains only what the agent legitimately knows (the `Observation` has no ground truth) and a short list of candidate goals pre-checked by A*, so the model chooses among feasible options instead of inventing coordinates.
- Validate the response; on timeout, error or an invalid choice, fall back to `UtilityPlanner` and log the reason.
- Make the planner selectable in the UI.

## Acceptance

- A mocked-`fetch` unit test covers: valid response, invalid response, timeout, and fallback.
- The e2e test still passes with the default (utility) planner.
- `.env.example` and a "Deploying with the LLM planner" section are added to the README, and `SECURITY.md` is updated if the threat model changes.
- No new dependency is added without asking first (see CONTRIBUTING).

## Pointers

- `src/agent/planner.ts` (`Planner`, `Observation`, `Decision`)
- `src/agent/utilityPlanner.ts` (`UtilityPlanner`, candidate generation and feasibility checks to reuse)
- `src/agent/agent.ts` (`requestDecision`, `apply`)
- `SECURITY.md` (design note on keys)
