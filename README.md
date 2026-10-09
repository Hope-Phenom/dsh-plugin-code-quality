# dsh-plugin-code-quality

A [DeepSeek Harness](https://github.com/deepseek-ai) plugin that adds two code-quality commands to the `/` menu:

| Command | What it does | Who can invoke it |
|---|---|---|
| `/simplify [target]` | Applies behavior-preserving cleanups to the code you changed — reuses helpers that already exist, removes needless complexity, cuts wasted work, and re-seats changes made at the wrong layer. Not a bug hunt. | you **and** the model |
| `/code-review [level] [--fix] [target]` | Hunts for real correctness defects in the current diff with several independent review angles, verifies every candidate before reporting it, and ranks what survives most-severe first. | you only |
| `/review …` | Alias of `/code-review`. Same behavior, same instructions. | you only |

Both commands follow the design that mainstream code review tooling has converged on, adapted to DeepSeek Harness's tools, instruction-file layout and subagent model.

---

## Install

```powershell
dsh plugin --profile <your-profile> add @hope_phenom/dsh-plugin-code-quality
```

Then restart the profile (or let HMR pick it up) and type `/` in the composer — `simplify`, `code-review` and `review` appear under the skills group.

For local development against a checkout:

```powershell
dsh plugin --profile <your-profile> add F:\path\to\dsh-plugin-code-quality
```

### Upgrading

`add` records a caret range, and pnpm keeps whatever exact version is already in `pnpm-lock.yaml`, so
running the install command again with the bare package name will **not** move you to a newer release. Name
the version explicitly, or remove the plugin and add it again:

```powershell
dsh plugin --profile <your-profile> add @hope_phenom/dsh-plugin-code-quality@0.1.1
```

Then fully restart the profile. Replacing a package that is already loaded needs a new module generation —
HMR only covers bundles that were not loaded before.

Behind a registry mirror the mirror itself can lag a release by minutes to hours, and pnpm's local metadata
cache outlives that lag. When the version you asked for cannot be found, pass the upstream registry:

```powershell
dsh plugin --profile <your-profile> add @hope_phenom/dsh-plugin-code-quality@0.1.1 --registry=https://registry.npmjs.org
```

### Requirements

- DSH with `@deepseek-ai/dsh-skill` and `@deepseek-ai/dsh-client-ui-skill` composed. Both are part of the shipped standard preset, so a stock install already has them.
- Node.js ≥ 20.
- The plugin has **no dependencies and no peer dependencies** — it imports nothing from DSH and talks to the host only through the `ctx` object it is handed.

---

## Usage

### `/simplify`

```text
/simplify                       # clean up everything changed since the upstream branch
/simplify src/parser.ts         # restrict the review to one path
/simplify 421                   # review a pull request instead of the local diff
```

Scope resolution, in order: a target you named, then `git diff '@{upstream}...HEAD'`, then `main...HEAD` (falling back to `origin/main`, `master`), then `HEAD~1`. Working-tree edits and untracked files are folded in, because the command is most useful *before* you commit. If nothing changed, it says so and stops.

Four independent reviewers look at the diff — **Reuse**, **Simplification**, **Efficiency** and **Altitude**. A finding only counts if it names the concrete replacement: the existing helper to call, the simpler form, the cheaper alternative, or the general mechanism the special case should fold into. Findings that cannot fill that slot are dropped before they reach you.

Surviving findings are deduplicated and applied directly. Anything whose fix would change intended behavior, or that needs work outside the diff, is skipped and reported as skipped rather than argued about.

### `/code-review`

```text
/code-review                    # balanced review at the default level
/code-review high               # more angles, higher findings cap, recall-biased verification
/code-review max --fix          # widest sweep, then apply the findings
/code-review high src/parser.ts # level plus a target
```

The level word is read out of your own message — there is no argument parser, because the command is delivered as instructions.

| Level | Correctness angles | Cleanup angles | Candidates per finder | Report cap | Verification bias |
|---|---|---|---|---|---|
| `low` | 3 | 0 | 4 | 5 | drop anything not `CONFIRMED` |
| `medium` *(default)* | 5 | 2 | 6 | 8 | balanced |
| `high` | 6 | 4 | 8 | 12 | keep `PLAUSIBLE` |
| `max` | 6 | 4 + sweep | 8 | 20 | keep `PLAUSIBLE` |

Six correctness angles are defined, and the level decides how many run — three at `low`, five at `medium`, all six at `high` and `max`:

| id | angle | the question it asks |
|---|---|---|
| C1 | line-by-line hunk scan | What input, state, timing or platform makes each changed line produce the wrong result — including unchanged lines of a touched function. |
| C2 | removed-behavior audit | What invariant did each deleted or replaced line enforce, and where does the new code re-establish it? |
| C3 | cross-file contract tracing | Does the change break a caller through a new precondition, return shape, throwing path or ordering requirement? |
| C4 | language and framework pitfalls | Which classic trap of the languages actually present in this diff is being stepped in? |
| C5 | async, concurrency and resource lifetime | Races, missing `await`, abandoned work, error paths that skip cleanup, listeners that outlive their owner. |
| C6 | error paths and boundaries | Empty collections, zero and negative values, null, multi-byte text, overflow, timeouts, partial writes, oversized payloads. |

Every candidate then goes to a **separate verifier** that is told to try to *refute* it and must answer `CONFIRMED`, `PLAUSIBLE` or `REFUTED`. At `high` and `max`, a final sweep reviewer sees the verified list and looks only for gaps. When the report cap forces a cut, correctness findings outrank cleanup, altitude and conventions findings.

Output is one line per finding:

```text
src/parser.ts:118 — the retry loop resets `attempts` inside the loop; a persistent 503 retries forever
```

If nothing survives verification it says so in one line instead of padding the report. `--fix` applies the surviving findings after reporting them; without it the command never edits a file.

---

## How it works

The plugin has no client half, no tools, no services and no HTTP routes. `lib/index.js` does exactly one thing:

```js
export const name = 'dsh-plugin-code-quality'
export const inject = ['skills']

export function apply(ctx) {
  for (const skill of SKILLS) ctx.skills.register(skill)
}
```

### Why skills instead of `ctx.commands`

DSH gives a plugin two ways to add a `/` command, and they are not equivalent:

- **`ctx.commands.register()`** publishes a *host command*. Its handler runs against the agent directly and, by default, produces no model message — a command that wants to make the model work has to submit a synthetic user message itself.
- **`ctx.skills.register()` with `userInvocable: true`** publishes a *skill*. The composer sends your message verbatim, `/simplify` token included, and the host appends the skill body as a `<skill_content>` instruction block at the pre-step boundary.

The second is exactly the substrate these two commands need: their entire content *is* an instruction document, your typed target text arrives intact, and there is no synthetic message pretending to be you.

### Invocation policy

`simplify` is registered with `{ modelInvocable: true, userInvocable: true }`, so the model also sees it in its skill catalog and can reach for it on its own — a behavior-preserving cleanup pass is a reasonable thing for an agent to decide it needs.

`code-review` and `review` are registered with `{ modelInvocable: false, userInvocable: true }`. They never enter the model's catalog and cannot be self-invoked; the `/` menu is their only entry point, where DSH marks them as user-only.

### `/review` is a second registration, not a pointer

`@deepseek-ai/dsh-skill` keys a runtime registration by `name` alone — there is no alias field (DSH's localized command aliases exist only for host commands, selected by first-party `definitionId`). `/review` is therefore registered as its own skill that shares the `code-review` body *by reference*, so the two cannot drift. The cost is a second row in the `/` menu.

---

## Design notes

The two commands follow a pattern that code review tooling has broadly converged on: split the review into several independent angles so no single pass has to be good at everything, send every candidate past a separate verifier before it is reported, and cap the report so a flood of marginal findings cannot bury the real ones.

A few choices here go beyond that pattern:

- **Angles.** Alongside the usual line-by-line, removed-behavior and cross-file angles, `C5` (async, concurrency and resource lifetime) and `C6` (error paths and boundaries) are included because they carry a lot of real defect mass that a general scan tends to skim past.
- **Fan-out tool.** Reviewers run as `subagent` children with `run_in_background: false` pinned. DSH's standard preset configures that tool as `continuable`, so without the flag it returns an id and forces the parent to poll instead of handing back a whole round of findings in one step. All finder calls go out in a single message so they run concurrently.
- **Effort levels.** A DSH skill body is static and there is no host API to select a level, so the level is parsed by the agent out of your own message, against the table above.
- **Instruction files.** DSH loads `$DSH_HOME/AGENTS.md` plus a per-directory project chain of `AGENTS.md` and its `AGENTS.local.md` overlay. That chain is normally injected automatically, so the conventions angle reads a file directly only when it was not.
- **Scope.** The review runs against your local diff and reports in the conversation. Nothing is posted to a pull request and nothing is published elsewhere.

Unofficial community project, MIT licensed, no commercial intent.

---

## Development

```powershell
npm test          # node --test: skill contract, plugin wiring, prompt conformance
npm run verify    # the same checks as a human-readable PASS/FAIL report
```

`test/prompts.test.js` is the enforcement point for `docs/PORT-SPEC.md` §7: it fails the build if a body loses the subagent fan-out contract, drops a verdict label, starts emitting prompt framing, slips in a vendor name, or grows past its word budget.

## License

[MIT](LICENSE)
