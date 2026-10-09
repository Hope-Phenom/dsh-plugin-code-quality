# Benchmark record

How `simplify` and `code-review` were validated against real repositories, what has been run, and what each
case is expected to prove. `PORT-SPEC.md` records what each failure taught the prompt; this file records the
test surface itself, so a case can be re-run without reconstructing the setup.

Everything here is about behaviour observed end to end. The offline gates (`npm test`, `npm run verify`)
check that the bodies still *contain* the clauses; they cannot check that an agent obeys them.

## 1. Running a case

### 1.1 The two invocation paths

A case can be run either way. Both have been used, and they agree.

**Real path.** In a DSH session whose working directory is the fixture, type the command:

```
/code-review low
/review
/simplify src/ingest.js
```

The host injects the skill body as a `<skill_content>` block at a pre-step boundary and the host's own slash
adjudication runs first. This is the only path that exercises the client menu, the alias registration and the
injection framing.

**Injected path.** For a case that would otherwise need a human to drive a session, hand the body to a
`subagent` as its instructions and tell it the user's message verbatim. This is faithful to the body's
content — it is the same string the host injects — but not to the injection framing, the slash adjudication or
the report reaching the user.

**Two operational facts the injected path must supply**, both of which are deviations:

- **Working directory.** A `subagent` does not run in the fixture. State the absolute repository root in the
  injected prompt and require every shell command to use it. The body already instructs the agent to resolve
  an absolute root and pass it to children, so this only supplies the root earlier than the body would.
- **Escaping.** The bodies are JavaScript template literals. Materialise them as plain text first, or the
  agent will meet `\`` sequences and an `export const` line.

Materialise both bodies to plain text, from the repository root:

```js
node -e "const fs=require('fs'),p='C:/Users/dev/AppData/Local/Temp/dsh-qa';fs.mkdirSync(p,{recursive:true});(async()=>{for(const [n,u,k] of [['code-review','file:///F:/WorkSpace/dsh-plugin-code-quality/lib/prompts/code-review.js','CODE_REVIEW_PROMPT'],['simplify','file:///F:/WorkSpace/dsh-plugin-code-quality/lib/prompts/simplify.js','SIMPLIFY_PROMPT']]){const m=await import(u);fs.writeFileSync(p+'/'+n+'.md',m[k]+'\n')}})()"
```

**Dependency: subagent nesting.** Both commands fan out, so an injected agent must be able to start children
of its own. A `subagent` may not exceed `maxDepth`, and exceeding it is a **runtime** error
(`subagent depth 2 exceeds maxDepth 1`) even though the tool is present in the child's tool list. That failure
mode is dangerous for this benchmark: the bodies accept a genuinely rejected `subagent` call as proof the tool
is unavailable and fall back to a single pass, so a nesting limit silently converts a fan-out case into a
fallback case and the run still looks clean. Set `maxDepth` to at least `2` for the injected path.

### 1.2 Judging a run

The report is only part of the evidence. For every case, check:

| What | How |
|---|---|
| Mechanism actually ran | Tally the `subagent` calls in the session log and compare with the level table |
| Verdicts | Each finding's label, and whether a refutation was grounded |
| Behaviour preserved | Run the case's own probes against the tree, never against the report's prose |
| Tests | `node tests/run.js` in the fixture, against the fixture's known baseline |
| Tree hygiene | `git status --porcelain` and `git ls-files --others --exclude-standard` |
| Whether the report overclaims | Compare each claimed observation with the command output it cites |

Session logs live at `C:\Users\dev\.dsh\sessions\--<workspace-slug>--\<session-id>\session.v4.jsonl.zstd`.
They are multi-frame zstd: split on the `28 b5 2f fd` magic and decompress each frame separately.

## 2. Fixtures

One repository, `F:\WorkSpace\dsh-code-quality-e2e`, whose committed state is healthy (12/12 checks). Each
variant is a patch against that commit, applied to a clean tree.

| Variant | Patch | Baseline | What it is for |
|---|---|---|---|
| A | `dsh-code-quality-e2e-dirty.patch` | **8/12** | Every change is a regression. A correct repair converges on the committed shape, so repair and revert are easy to confuse — this is the case that first caught a full revert |
| B | `dsh-code-quality-e2e-dirty-B.patch` | **15/15** | A healthy but messy diff: all checks pass, so the only work is cleanup. Tests that a green suite does not make a diff good |
| C | `dsh-code-quality-e2e-dirty-C.patch` | **13/16** | Defects are *additions* — a falsy-zero default and an off-by-one loop start inside two functions the base commit does not contain. A correct repair must keep both functions and edit them, so it cannot be a restoration, and a revert deletes them and fails loudly on an unresolved import |

Reset between cases:

```powershell
cd F:\WorkSpace\dsh-code-quality-e2e
git checkout -- .
git apply F:\WorkSpace\dsh-code-quality-e2e-dirty<variant>.patch
git status --porcelain          # expect exactly the variant's files
git ls-files --others --exclude-standard   # expect empty
```

Variant A's planted defects: guards removed from `clampLimit` (`src/limits.js`); the `await` dropped from
`client.audit(items)` and the `Set` dedup replaced by an `items.some` scan (`src/ingest.js`); an inlined copy
of `normalizeTag`; a dead `LEGACY_PAGE_SIZE`; and a bolted-on `summary` branch in `buildReport` duplicating
the row mapping (`src/report.js`).

## 3. Case matrix

| # | Case | Fixture | Status |
|---|---|---|---|
| 1 | `simplify` on a diff where every change is a regression | A | **run** — reverted the whole diff (defect), re-run passed |
| 2 | `simplify` on a healthy-but-messy diff | B | **run** — passed, 3/3 cleanups |
| 3 | `code-review` at `medium` | A | **run** — passed after the fan-out fix |
| 4 | `code-review high` | A | **run** — passed, 21 subagent calls |
| 5 | `review` alias | A | **run** — passed at `medium`, 15 subagent calls |
| 6 | `code-review --fix` | A | **run** ×3 — failed, failed, passed |
| 7 | `code-review --fix` on additions-only defects | C | **run** ×2 — passed; the second escalated a rule collision |
| 8 | `code-review low` | A | **run** — passed; raised finding L1 below |
| 9 | `code-review max` | A | **run** — mechanism passed; raised finding A1 below |
| 10a | `code-review`, nothing changed | clean clone | **run** — passed, 0 subagent calls, one-line empty report |
| 10b | `simplify`, nothing changed | clean clone | **run** — failed, then **passed** after the S1 fix |
| 11 | Explicit target argument | A | **run** — passed, 12 subagent calls, reviewed only the named file |
| 12 | Report language, and appended guidance | A | **run** — passed; Chinese message produced a Chinese report, and the extra words were not read as a target |
| 13 | Untracked file inside the diff | variant D | **run** — passed; the only review target was invisible to `git diff HEAD` |
| 14 | Model-initiated `simplify` (via the `skill` tool) | A | **run** — passed; `code-review` refused with a clean error |
| 15 | Plugin disable / uninstall | — | **not runnable here** — see 4.13 |
| 16 | Non-git directory | copy of A | **run** — failed; surveyed the whole tree instead of stopping |
| 17 | Large diff (tens of files) | `dsh-bench-large` | **run** — passed; 20 files, and the long-diff branch sent reproduction commands instead of diff text |

Cases 8–10, 12 and 14 need no new fixture. Cases 13 and 17 do. Cases 15 and 16 are environment cases.

### Per-case expectations

- **8 `low`** — 3 correctness angles C1/C2/C3 only, no cleanup angles, no Phase-3 sweep; candidate cap 4;
  report cap 5; precision bias, so only `CONFIRMED` survives; a coverage limitation must be stated.
- **9 `max`** — 6 correctness angles, 4 cleanup angles, candidate cap 8, report cap 20, `PLAUSIBLE` kept and
  ranked after `CONFIRMED`, plus the Phase-3 sweep; the largest fan-out of any level.
- **10 clean tree** — the body says to say so and stop. Expect no fan-out and no invented target.
- **11 explicit target** — the message names a path; that wins over the derived range, and only that file is
  reviewed. All recorded runs used bare commands, so this path has no coverage at all.
- **12 language** — a message containing Chinese must produce a Chinese report (rule: the language the user
  has actually written). A bare command has no language to read and falls back to English. An appended
  requirement such as `用中文汇报` must be obeyed as guidance, never parsed as a review target.
- **13 untracked files** — `git diff HEAD` does not show an untracked file's contents, and the body
  explicitly requires folding in files that only `git status --porcelain` mentions. Nothing has exercised it.
- **14 model-initiated** — `simplify` is `modelInvocable`, `code-review` is not. Partial evidence already
  exists: the live skill catalog in a session lists `simplify` and does not list `code-review`.
- **16 non-git directory** — the body treats a failing git command as information. Expect a stated refusal
  rather than a sequence of guesses.

## 4. Recorded results

### 4.1 Case 8 — `code-review low` on variant A (injected path)

**Pass.** 8 `subagent` calls: 3 finders, one per `low` angle (C1, C2, C3), then 5 fresh verifiers, one per
deduped candidate. Four findings, all `CONFIRMED`, inside the cap of 5 and consistent with the precision bias;
no cleanup angle and no sweep, and the report says so explicitly ("Level `low` ran no cleanup angles and no
Phase-3 sweep, so those were not covered").

The findings map onto the fixture's four failing checks: the dropped `await`; the missing `LIMIT_MIN` branch;
the missing `Number.isInteger` branch; and the `Set` → `items.some` rewrite, which it caught on behaviour
(`NaN` ids are no longer collapsed by SameValueZero) as well as cost (measured 212 ms against 1.7 ms). It also
declined two candidates that no `low` angle selects — the inlined `normalizeTag` copy and the dead
`LEGACY_PAGE_SIZE` — and said why, rather than silently dropping them.

### 4.2 Finding L1 — finder children write into the tree

The `low` run reported, unprompted:

> Limit: finder children left two scratch probes (`scratch-probe.mjs`, `scratch-probe2.mjs`) in the repository
> root; I deleted both.

The no-scratch-artifacts rule lives in the `## Fixing` section, which only `--fix` runs receive. Finders are
told to reproduce a mechanism, which needs a probe, and nothing tells them where a probe may live — so they
write into the working tree. The parent cleaned up here, and only because it noticed; a parent that does not
notice leaves exactly the artifact the rule exists to prevent, in a run that is not even in `--fix` mode.

**Status: fixed.** Dispatch now tells every child — finder and verifier alike — that a probe belongs in a
temporary directory outside the repository, never in the working tree, and must be deleted before it returns.
Guarded by `prompts/probe-location` in both bodies. Re-running case 8 confirms it.

### 4.3 Cases 10a and 11 — passes

**10a, `/code-review` with nothing changed. Pass.** Zero `subagent` calls: scope resolution returned an empty
diff, so the run printed "the diff is empty" and stopped before any fan-out, exactly as the body instructs.
It walked the whole ladder and reported the failing rungs as information rather than retrying them
(`origin/master` ambiguous — no such ref; `HEAD~1` ambiguous — the repository has exactly one commit), then
refused to review the committed files on the grounds that committed code outside the resolved scope is a
non-goal, and offered the explicit form instead (`/code-review HEAD`). It created, modified and deleted
nothing. It also stated its own limitation: no independent verification occurred because nothing was reported.

**11, `/code-review src/limits.js`. Pass.** The named path won over the derived range, and only that file was
reviewed, with the other two changed files read solely as callers and tests. 12 `subagent` calls — 7 finders
at `medium` (C1–C5 plus the R and S cleanup angles) and 5 fresh verifiers, none of them the finder that raised
its candidate. Two findings, both `CONFIRMED` against `git show HEAD:src/limits.js`, and two candidates
refuted with grounded reasons. It applied the dedup key `(file, symbol, root-cause mechanism)` explicitly,
noted that `medium` runs no sweep and keeps no `PLAUSIBLE` items, and — the sharpest part — declined to
attribute the suite's fourth failure because it originates in `src/ingest.js`, outside the target the user
named.

### 4.4 Finding S1 — an empty diff was replaced by the committed history

`/simplify` on the same empty tree as 10a did not stop. It treated the repository's single committed root
commit as the change set, ran all four cleanup angles, and **edited three files**, including `src/text.js`,
which no change set implicated. The suite stayed green, so nothing failed loudly; the run changed observable
behaviour anyway by routing a caller-supplied `groupSize` through `clampLimit` (so `10000` is now silently
clamped to `500`), which its own contract forbids, and it said so: "the only deviation from strict
no-behaviour-change in this pass".

The rule was present and the run broke it — "if nothing is changed at all, say so and stop: inventing work to
justify the invocation is worse than no work" — by reading the failed ladder as evidence that the commit
*was* the change set. **Status: fixed** by naming the substitution to refuse; see `PORT-SPEC.md` §9.11.
Re-running case 10b is the check that the fix holds.

### 4.5 Case 9 — `code-review max` on variant A

**Mechanism passed, with one arithmetic deviation.** 17 `subagent` calls: 8 finders, 8 fresh verifiers, and
the Phase 3 sweep. Nine findings, inside the cap of 20, one of them `PLAUSIBLE` and ranked last as the `max`
bias requires. The sweep ran a differential fuzz of HEAD against the working tree across `kind` × `limit` ×
`count` and returned `NONE`. Two candidates were refuted with differential evidence — verifiers reconstructed
the pre-change modules from `git show HEAD:` and ran old against new on identical stubs, which refuted both
the claim that the dedup *placement* change alters which record survives and the claim that the section
construction is duplicated between the `buildReport` branches. The limitations paragraph was unusually
useful: it ranked the `NaN`-id finding `PLAUSIBLE` because `id: string` is the documented contract and no
in-repo caller violates it, flagged its own timings as machine-dependent, and noted that a dead `LIMIT_MIN`
is a corollary of the guard finding rather than an independent mechanism.

**The deviation, and what it proves about the harness.** One finder per angle means ten calls (six
correctness plus four cleanup) plus the conventions child. The run sent eight, pairing `R+S` and `E+A`, and
sent no conventions child. All four cleanup angles still produced findings and the conventions rules were
still cited, so nothing was missed — but the arithmetic was ambiguous, and is now pinned. See `PORT-SPEC.md`
§9.13.

### 4.6 Case 10b re-run — `simplify` on the clean tree, after the S1 fix

**Passed.** Zero `subagent` calls; the run stopped at scope resolution. It walked the whole ladder, reported
`master` and `HEAD~1` as non-existent, and stated the fixed rule back almost verbatim: "a repository's
committed state and a missing parent are not a change set, and reviewing the whole tree is not something to
invent in its place." It created, modified and deleted nothing, and confirmed the tree was byte-identical
afterwards. It also checked `npm test` (12/12) and noted that the `AGENTS.md` rule requiring a green suite
was not engaged because nothing was modified, then told the user what would make the command useful.

**Same harness, opposite outcome**, which is the evidence that the fix — not the harness — changed the
behaviour.

### 4.7 Evidence that the L1 fix works

Two independent observations in case 9, neither of them solicited: finder and verifier children **reconstructed
the pre-change modules into `$env:TEMP`** rather than into the tree, and the parent closed by verifying
`git status --porcelain --untracked-files=all` reported exactly the three modified files and zero untracked.
Before the fix, the same command left two probe scripts in the repository root.

### 4.8 Case 13 — an untracked file was the entire change set

**Passed, and it is the sharpest case in the matrix.** Variant D is the clean base plus one untracked
`src/digest.js`, so `git diff HEAD` is **empty** and the whole review target is invisible to a diff read; the
file is reachable only by noticing `?? src/digest.js` in `git status --porcelain` and reading it. The suite is
green at 12/12, because nothing tests the new file.

The run walked the ladder, reported every rung's failure as information, found `git diff HEAD` empty, then read
status, and concluded: "a file no committed range mentions — so the entire change set is that one file's
addition". It reviewed it and found both planted defects with reproduced triggers — the loop starting at
`index = 1`, so the first item of every batch is never rendered, and `options.width || 4` rewriting an
explicit `0` — plus the raw, unclamped `width`, citing `AGENTS.md`. It also noticed that the file's `||`
fallback sits directly above a `??` fallback for the sibling option. Two cleanup candidates were refuted
correctly: the loop is not a re-implementation of `chunk` (`chunk` returns page arrays and throws below
size 1), and a `slice`/`filter`/`map` collapse is not equivalent at `2.5`, `-1` or `'abc'`, so it would be a
behaviour change. It then guarded against the pre/post-change trap in a way the body asks for but no earlier
case had exercised: it confirmed the verifiers read the file **as present on disk**, since no committed
version exists to mislead them.

### 4.9 Case 12 — report language and appended guidance

**Passed.** The message was `/code-review 请看看这次的改动`: Chinese prose, no language instruction, and words
that could be mistaken for a target. The run reported in Chinese, giving the rule as its reason ("the user
actually wrote Chinese this turn"), and stated explicitly that it did **not** re-parse 这次的改动 as a
parseable target — it resolved scope from git and folded in the working tree.

### 4.10 Three fixes confirmed by cases 12 and 13

Both cases are independent evidence for fixes made earlier in the matrix, which is worth recording because
each was previously supported only by its own failing run:

- **A1 (fan-out arithmetic).** Both sent **8 finders at `medium`** — C1–C5 plus R, S *and* the conventions
  angle. Every `medium` run before the fix sent 7, with no conventions child.
- **L1 (probe location).** Both put finder and verifier probes in `$env:TEMP` and deleted them; case 12 said
  so explicitly, and both closed with `git status --porcelain` showing only the expected files.
- **The language fallback.** Case 13 reported in English for a bare command and gave the rule as its reason.

### 4.11 Case 16 — a non-git directory became the whole tree

**Failed.** The copy has no `.git` anywhere up the tree and still carries variant A's three modified files, so
the suite reports 8/12 while no revision range exists. Every git command returned `fatal: not a git
repository`. The run declared its scope to be **all nine files**, said it had "treated every line as changed",
and spent 17 `subagent` calls on a whole-repository audit — the same substitution as case 10b, one rung
further out: a missing repository became the working tree. See `PORT-SPEC.md` §9.14. Status: **fixed**.

The findings were good (one catches `process.exit` in the harness preempting Node's unhandled-rejection
reporting, so a suite can print all green while the process is fatally errored), which is exactly why the
scope substitution matters: a useful report under a scope the user never set is still the wrong command.

### 4.12 Case 14 — the model-invocation policy

**Passed.** Probed from a fresh subagent, which reported the catalog `avalonia-design, commit,
diagnose-windows-sandbox-acl, frontend-design, office-docx, office-pptx, office-xlsx, simplify` — `simplify`
present, `code-review` absent — and then called the `skill` tool with `code-review` and got

```text
Error: skill "code-review" is not available for model invocation
```

So the `modelInvocable` split is enforced at the tool boundary with a clean message rather than by omission
from a list. Asked whether it would reach for `simplify` when told to clean up a change it had just made, it
said yes and named the deciding words from the catalog description ("Clean up the code you changed"). That
covers the routing decision; the body it would then execute is the same body cases 1 and 2 exercise.

### 4.13 Case 15 — not runnable from this environment

The `desktop` profile is owned by the running Electron application, and the CLI refuses to touch it:

```text
$ dsh --profile desktop --dump-config
error: profile "desktop" is managed exclusively by the Electron application
```

That removes the only offline way to observe composition, because `--dump-config` is what would show whether
the row survives a disable. `dsh plugin` itself proxies to `pnpm`, so there is no CLI-level enable/disable
either; a disable is a `disabled: true` override on the row id `code-quality` (`- id: code-quality` from the
bundle patch), which is what the Settings toggle writes.

**To run it:** toggle the plugin off in Settings, restart, and confirm the three skills leave the `/` menu and
the profile boots without a dangling row; then toggle it on and confirm they return. The mechanical half is
already evidenced — the row id the override must target is `code-quality`, and the plugin manager writes
exactly `disabled: !enabled` on the matched item.

### 4.14 Case 17 — twenty files, and the long-diff branch

**Passed, and it exercised the one branch nothing else had.** The fixture is a new repository, `dsh-bench-large`:
twenty modules committed in a clean state, then all twenty rewritten in the working tree so that each drops its
argument guard and substitutes `return (value || N) * N`. The diff is 20 files, 780 lines, 24 KB — not short.

- **Scope held.** All twenty files and twenty hunks were in scope; nothing was truncated.
- **The long-diff branch works.** The body says a child's prompt carries "the diff text when it is short and
  otherwise the exact reproduction commands with a note that they already ran", and the run quoted that rule
  and sent `git diff HEAD`, per-file `git diff HEAD -- <path>` and `git show HEAD:<path>` instead of the text.
  It also noticed `core.autocrlf` filling the output with warnings and adapted with `-c core.safecrlf=false`.
- **One finder per angle, conventions included** — 8 finders and 8 fresh verifiers, 16 calls. The A1 fix holds
  at a fourth site.
- **Dedup worked and one refutation was sharp.** Fifty candidate lines collapsed to eight mechanisms; the
  refuted one claimed `scale20(1e308)` returns `Infinity` where HEAD did not, and the verifier killed it by
  observing that HEAD returns `Infinity` for that input too — the deleted guards constrained the argument,
  never the product.
- No scratch files; the tree held only the twenty modified files afterwards.

**A latent tension, recorded rather than patched.** The dedup key is `(file, symbol, root-cause mechanism)`,
which is **per file**, while the report cap is **global** — 8 at `medium`. Twenty occurrences of one identical
rewrite are therefore twenty keys but one mechanism, and the run resolved that by collapsing them into a single
finding that names the first file and states in its limitations that the finding "applies verbatim to every
`src/mNN.js`". That is the better report, and it is not what the key literally says; with twenty *distinct*
mechanisms the same cap would cut twelve findings, and nothing in the body requires saying so.

The cap did not bind here (7 findings against 8), so **no failure was observed** and no clause was added — the
project's rule is that every clause carries a run behind it. Both halves of the tension are open items below.

## 5. Open items

1. ~~Finding L1~~ — fixed and confirmed by cases 9, 12 and 13.
2. ~~Finding S1~~ — fixed; case 10b re-ran clean (see 4.6).
3. ~~Finding A1~~ — fixed and confirmed twice by cases 12 and 13 (see 4.10).
4. ~~Case 16 (non-git directory)~~ — failed, fixed, recorded in 4.11.
5. ~~Case 14 (model-invoked)~~ — passed, recorded in 4.12.
6. Case 15 (disable/uninstall) — not runnable from this environment; procedure recorded in 4.13.
7. ~~Case 17 (large diff)~~ — passed, recorded in 4.14.
8. **Latent tension, no observed failure:** the per-file dedup key against the global report cap. A diff whose
   distinct mechanisms outnumber the cap would be truncated silently, and the body neither permits collapsing
   one mechanism across files nor requires disclosing a cut. Needs a fixture of >8 *distinct* mechanisms to
   turn this into an observed failure — and per the project's rule, only that justifies a clause.
9. Case 15's runtime half (disable, restart, confirm the three skills leave the `/` menu) awaits a GUI action;
   the procedure and the mechanical evidence are in 4.13.
10. `PORT-SPEC.md` §9.10's fallback rule now has evidence for the bare-command case (case 13) and the
    language-bearing case (case 12); a message naming a language *other* than the user's own has not been run.
11. The injected path has not been checked against the real path on the same case and fixture. Running a case
    both ways would settle whether the harness itself changes any verdict.

## 6. Findings so far

| id | trigger | what it was | status |
|---|---|---|---|
| — | case 1 | `/simplify` reverted the entire diff | fixed (`prompts/revert-boundary`) |
| — | case 3 | `/code-review` claimed the fan-out was unavailable and skipped verification | fixed (`prompts/fanout-not-optional`) |
| — | case 6 | `--fix` changed semantics with surplus machinery, and reported an expectation as an observation | fixed (`prompts/fix-means-restore`) |
| — | case 6 | `--fix` left its comparison harness in the tree | fixed (`prompts/no-scratch-artifacts`) |
| — | case 6 | a cleanup finding could never be `CONFIRMED`, so a verifier dropped a real one | fixed (`prompts/cleanup-verified-own-terms`) |
| — | case 7 | `--fix` was silent on whether a test may be rewritten | fixed (`prompts/tests-are-the-spec`) |
| — | case 7 | the report language was invented when the message carried none | fixed (`prompts/report-language`) |
| L1 | case 8 | finder children wrote probe scripts into the repository | fixed (`prompts/probe-location`) |
| S1 | case 10b | an empty diff became the committed history, and three files were edited | fixed (`prompts/empty-scope`) |
| A1 | case 9 | the table's angle counts were never tied to the finder call count | fixed (`prompts/fanout-arithmetic`) |
| G1 | case 16 | an unresolvable repository became the whole tree | fixed (`prompts/no-repo-scope`) |

Findings S1, A1, G1 and the three earlier fixes were each re-confirmed by a later independent case, which is
recorded in 4.10 and in each `PORT-SPEC.md` §9.x entry.
