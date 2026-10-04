# AGENTS.md

## Project Overview

This project is a lightweight mind-map application built around Mind Elixir.

Primary goals:

- Keep the frontend responsive and visually polished.
- Support smooth node creation, movement, expansion, and related animations.
- Keep the architecture simple and easy to modify.
- Avoid backend infrastructure unless it is clearly necessary.
- Prefer browser-native capabilities over introducing services or dependencies.

## Core Technical Direction

### Frontend

Prefer:

- TypeScript
- Vite
- Mind Elixir
- Native DOM APIs
- Web Animations API
- CSS transitions / keyframes
- Browser storage where sufficient

Do not introduce a large frontend framework unless the existing project already depends on one or the requested feature clearly benefits from it.

For animation-heavy behavior, prefer:

1. `transform`
2. `opacity`
3. Web Animations API
4. FLIP animation for layout changes

Avoid animating layout-heavy properties such as `top`, `left`, `width`, and `height` continuously unless there is no practical alternative.

### Backend

The default assumption is: **no backend**.

Before adding server-side code, check whether the requirement can be implemented with:

- in-memory state
- `localStorage`
- IndexedDB
- static JSON
- URL state
- browser file import/export
- client-side APIs

Add a backend only when there is a concrete requirement such as:

- multi-device persistence
- authentication
- private server-side secrets
- shared collaboration
- server-side AI/API calls
- durable shared data
- webhook handling

If a backend is required, keep it minimal.

Preferred characteristics:

- one small service
- minimal dependencies
- stateless where possible
- JSON APIs only
- no ORM unless relational complexity genuinely requires one
- no message queue unless asynchronous processing is unavoidable
- no microservices
- no container orchestration for a small deployment

Preferred lightweight options, in order:

1. Edge/serverless function when only a few endpoints are needed
2. Small Hono-based HTTP API
3. Minimal Node.js HTTP server if external dependencies are unnecessary

Do not introduce Express, NestJS, a full MVC stack, GraphQL, or a separate service layer unless the project requirements justify the additional complexity.

## Mind Elixir Integration

Treat Mind Elixir as the source of truth for mind-map structure and layout.

Prefer public APIs and documented events over modifying internal library state.

Useful integration points may include:

- node creation
- node selection
- node expansion/collapse
- operation events
- element lookup
- viewport movement

When adding behavior around Mind Elixir:

- wait for the relevant Mind Elixir operation to complete before measuring final layout
- avoid mutating Mind Elixir-managed DOM in ways that break its internal assumptions
- isolate DOM animation logic from data mutation logic
- keep animation cleanup explicit

## Animation Guidelines

Animations should improve spatial understanding, not merely decorate the interface.

### Node insertion

Preferred sequence:

1. Record existing node positions if layout will change.
2. Add the node through Mind Elixir.
3. Measure the updated layout.
4. Animate displaced nodes using FLIP.
5. Animate the new connector if practical.
6. Fade/slide/scale the new node into place.
7. Optionally apply a short focus pulse.

Recommended timing:

- reflow: 180-300 ms
- node appearance: 160-260 ms
- connector drawing: 180-300 ms
- focus pulse: under 500 ms
- stagger between siblings: 30-70 ms

Keep total interaction latency visually short.

### Preferred motion

Use subtle motion such as:

```ts
opacity: 0 -> 1
scale: 0.92 -> 1
translateX: +/-12px -> 0
translateY: +/-8px -> 0
```

Avoid large bounce effects unless explicitly requested.

For spring-like motion, use restrained overshoot.

### FLIP

Use FLIP for layout transitions when existing nodes move because of insertion, deletion, expansion, collapse, or reordering.

Pattern:

```ts
First  -> capture old DOMRect
Last   -> perform Mind Elixir operation and capture new DOMRect
Invert -> apply transform matching the old position
Play   -> animate transform back to identity
```

Keep layout measurement and animation phases separate to reduce layout thrashing.

### Connector animation

If connector paths are accessible as SVG paths, line-drawing effects may use:

```ts
stroke-dasharray
stroke-dashoffset
```

Do not tightly couple application logic to undocumented SVG structure without isolating that dependency behind a helper.

### Reduced motion

Respect:

```css
@media (prefers-reduced-motion: reduce)
```

When reduced motion is enabled:

- remove decorative movement
- reduce durations substantially or disable animation
- preserve state changes and focus indication

## Architecture

Keep the codebase shallow.

Preferred structure:

```text
src/
  app/
  mindmap/
    mindmap.ts
    animations.ts
    node-actions.ts
  storage/
  ui/
  main.ts
```

If a backend becomes necessary:

```text
server/
  index.ts
  routes/
```

Do not create additional architectural layers without a concrete need.

Avoid premature abstractions such as:

- repositories for browser-only data
- service classes containing only one function
- dependency injection containers
- generic event buses when Mind Elixir events already solve the problem
- duplicated domain models

## State Management

Use the smallest state mechanism that works.

Preference order:

1. local function/component state
2. Mind Elixir's own state
3. small shared TypeScript module
4. lightweight state library only when necessary

Do not introduce Redux-style global state for simple mind-map interactions.

## Persistence

For local-only persistence:

- prefer IndexedDB for larger structured maps
- use localStorage only for small preferences or small documents
- support JSON import/export where useful

Keep persisted data versioned.

Example:

```ts
type PersistedMindMap = {
  version: 1
  updatedAt: string
  data: unknown
}
```

Migration logic should remain explicit and simple.

## API Design

If server APIs are required:

- keep endpoints resource-oriented
- return JSON
- validate request input
- return explicit HTTP status codes
- avoid deeply nested payloads
- avoid inventing generic RPC layers

Example:

```text
GET    /api/maps/:id
PUT    /api/maps/:id
POST   /api/maps
DELETE /api/maps/:id
```

If only one server action is needed, expose only that action instead of designing an entire CRUD API.

## AI Features

If AI-generated nodes are added:

- keep API keys exclusively on the server
- stream only when the UX benefits from incremental output
- batch node insertion where possible
- stagger visual appearance separately from data generation
- distinguish generated content from persisted application state

For generated sibling nodes, prefer a staggered reveal rather than large simultaneous motion.

Do not add a backend solely to proxy requests that do not require secret credentials or server-side policy enforcement.

## Dependencies

Before adding a dependency, verify that the platform or existing code cannot reasonably solve the problem.

Prefer dependencies that are:

- small
- actively maintained
- tree-shakeable
- narrowly scoped
- TypeScript-friendly

Avoid dependency additions for:

- simple debounce/throttle helpers
- UUID generation when `crypto.randomUUID()` is sufficient
- basic animation helpers when Web Animations API is sufficient
- basic fetch wrappers
- small utility functions

## Performance

Mind maps can become DOM-heavy.

Therefore:

- animate `transform` and `opacity`
- batch reads before writes
- avoid repeated `getBoundingClientRect()` calls inside loops mixed with DOM writes
- avoid unnecessary full-map rerenders
- debounce persistence
- avoid observers unless they solve a specific problem
- clean up animations and listeners when no longer needed

When profiling, prioritize:

1. layout
2. style recalculation
3. paint
4. long JavaScript tasks

## Accessibility

Interactive nodes must remain keyboard-accessible.

Animation must not be required to understand application state.

Respect reduced-motion preferences.

Do not remove focus outlines without providing an equivalent visible focus state.

Use semantic buttons for actions rather than clickable generic elements where possible.

## Error Handling

Fail locally and visibly.

For frontend-only features:

- avoid global error systems unless needed
- surface actionable errors near the relevant action
- do not silently discard persistence failures

For backend calls:

- handle non-2xx responses
- handle network errors
- use timeouts when external services are involved
- avoid infinite retries

## Testing

Prioritize tests around behavior that is easy to regress:

- node insertion
- node deletion
- expand/collapse
- persistence
- import/export
- animation helper calculations
- backend request validation, if a backend exists

Do not write tests that assert exact animation frame timing.

For animation logic, test:

- correct affected nodes
- correct start/end transforms
- cleanup after completion
- reduced-motion behavior

## Implementation Rules for Agents

When modifying this repository:

1. Inspect the existing implementation before introducing new architecture.
2. Prefer extending existing modules over creating parallel systems.
3. Keep changes narrowly scoped to the requested behavior.
4. Do not add a backend unless the feature requires one.
5. Do not add a database unless durable shared persistence is required.
6. Do not add authentication unless there is an actual authenticated resource.
7. Prefer browser APIs and Mind Elixir public APIs.
8. Keep animations subtle and interruptible.
9. Respect `prefers-reduced-motion`.
10. Avoid undocumented Mind Elixir internals where a public API exists.
11. If undocumented DOM structure must be used, isolate it in one module.
12. Keep TypeScript types explicit at API and persistence boundaries.
13. Remove dead code created by the change.
14. Do not refactor unrelated code.
15. Prefer the simplest implementation that satisfies the requirement.

## Definition of Done

A change is complete when:

- the requested behavior works
- existing mind-map operations still work
- no unnecessary backend or dependency was introduced
- animation does not cause obvious layout jank
- reduced-motion mode remains usable
- persisted data remains compatible or has an explicit migration
- code is typed and locally understandable
- tests or manual verification cover the changed behavior

## Decision Principle

When multiple implementations are viable, choose the one with:

1. fewer moving parts
2. fewer dependencies
3. less server infrastructure
4. clearer failure modes
5. easier removal or replacement later

The project should remain frontend-first and lightweight unless product requirements force additional complexity.
