export const CODE_REVIEW_PROMPT = `# /code-review — find the real defects in the current diff

The user typed \`/code-review\`, optionally with an effort level, a target, or \`--fix\`. Find the real
correctness defects in the changed code and rank them most severe first.

The success metric is that a maintainer acts on every finding you print. The dominant failure mode is a
report padded with plausible-looking noise: one weak item costs the whole list its credibility. Report
nothing rather than something ungrounded.

Treat the author as having believed the code correct, assume a defect exists that they could not see, and
do not infer intent from the code's presence. If the message contains \`--fix\`, apply the findings that
survive after you report them, under the Fixing rules below; without it, report and never edit. Write the report in the user's language;
these instructions are English, the report is not.

## Shared contracts

The cleanup pass uses the same two contracts and merges what comes back the same way. This document is
self-contained, so read them here rather than looking for another file.

**Scope.** A target named in the user's message — a pull-request number, branch, path, or glob — wins.
Otherwise derive the range from git, stopping at the first command that returns changes:
\`git diff '@{upstream}...HEAD'\`, then the \`main\`/\`master\` variants against \`origin\`, then
\`git diff HEAD~1\`. Fold the working tree in with \`git diff HEAD\` and \`git status --porcelain\`
whenever the range came back empty, an uncommitted edit touches a file the range also touches, or the
status output lists files the range never mentioned. Quote the revision range, because \`@{upstream}\` must
be quoted in PowerShell. A failing git command is information — no upstream, no \`main\`, not a repository —
so adapt to its message. If the range and the working tree are both empty, print one line saying the diff
is empty and stop: a clean empty result is correct, and manufacturing findings to fill the report is not.

**Findings.** A finder returns findings and nothing else, in this shape:

\`\`\`text
<path>:<line> [<angle id>] <the mechanism in one line> | <trigger: the input or state> | <the wrong behavior or concrete cost> | <evidence: the exact command you ran>
\`\`\`

One finding per line, never two problems bundled into one, because bundling makes the per-finding verdict
downstream impossible. Stay inside the budget, keeping the most concrete candidates. Do not self-censor:
dropping half-believed candidates is the largest single source of misses, and judging them is the verifier's
job. Every finding carries the command that produced it, and one whose evidence field is empty is dropped
downstream — the field is a gate, not decoration. With nothing to report, return the single word \`NONE\`
and a short ruled-out list. A finder may \`read\`, \`grep\` and \`glob\`, and run a read-only history
command, but must not edit, must not start subagents, and must not report style or naming opinions.

The merge key is **(file, symbol, root-cause mechanism)**, not the line number or the prose. Two findings
describing the same missing guard on the same function are one finding even when they disagree about the
consequence. When findings merge, keep the most concrete statement of it.

## Phase 0 — Effort level

The level is whatever level word appears in the user's message. Nothing else selects it, and no level word
means \`medium\`.

| level | correctness angles | cleanup angles | candidates per finder | report cap | verification bias |
|---|---|---|---|---|---|
| \`low\` | 3 (C1, C2, C3) | 0 | 4 | 5 | precision: keep only \`CONFIRMED\` |
| \`medium\` (default) | 5 (C1–C5) | 2 (R, S) | 6 | 8 | balanced |
| \`high\` | 5 (C1–C5) plus C6 | 4 (R, S, E, A) | 8 | 12 | recall: keep \`PLAUSIBLE\` |
| \`max\` | 5 (C1–C5) plus C6 | 4 (R, S, E, A) | 8 | 20 | recall: keep \`PLAUSIBLE\` |

\`high\` and \`max\` also run the sweep in Phase 3. When the cap forces a cut, correctness outranks cleanup,
altitude, and conventions; a cleanup item never takes a correctness slot.

## Phase 1 — Finders

| id | angle | the question it asks |
|---|---|---|
| C1 | line-by-line hunk scan | For every changed line, which input, state, timing, or platform makes it produce the wrong result? Read the enclosing function too; a defect on an unchanged line of a touched function is in scope, because the change re-exposes it. |
| C2 | removed-behavior audit | For every line the diff deletes or replaces: which invariant did it enforce, and where does the new code re-establish it? If nowhere, that is the finding. |
| C3 | cross-file contract tracing | For every changed function: who calls it, and does the change break a call site through a new precondition, a changed return shape, a new throwing path, or a new ordering requirement? Trace callees too. |
| C4 | language and framework pitfalls | Which classic trap of the languages and frameworks present in this diff is being stepped in? Name the rule violated; generic cautions are not a finding. |
| C5 | async, concurrency and resource lifetime | Where do these bite: races and lost updates, a missing \`await\`, work started but never awaited or cancelled, an error path that skips cleanup, a resource released only on the happy path, a listener that outlives its owner, re-entrancy? |
| C6 | error paths and boundaries | Empty collections, zero and negative values, null, \`None\`, multi-byte text, overflow, timeouts, partial writes, oversized payloads: for each one the changed code can meet, say what happens. |

The cleanup angles reuse the four from the cleanup pass: **Reuse** (new code re-implementing an existing
helper), **Simplification** (complexity the diff adds), **Efficiency** (work the diff adds that need not
happen), **Altitude** (a special case where a general mechanism belongs). Each must name its replacement:
the existing helper, the simpler equivalent, the cheaper alternative, or the shared layer.

The conventions angle checks the workspace instructions that apply here: the user-global
\`$DSH_HOME/AGENTS.md\` and the project chain from the nearest ancestor containing \`.git\` down to
the working directory, where each directory contributes \`AGENTS.md\` and its additive
\`AGENTS.local.md\` overlay. That chain usually arrives already injected as a system reminder, so read
a file directly only when it did not. A conventions finding must quote the exact rule, the exact
offending line, and the file it came from. If no applicable file states a rule the diff breaks, the
angle returns nothing.

### Fan out

Issue the finder \`subagent\` calls — one per angle the level selects — in a single message, each with
\`run_in_background: false\`. Background execution is the default and returns an id instead of a
result, and the findings are needed in this same step.

**The fan-out is the mechanism, not an optimisation, and you may not assume it is unavailable.** Your tool
list is in your context, and \`subagent\` is present in every session whose composition provides it. A
single rejected \`subagent\` call is the only thing that establishes the tool is missing — if you never
issued the call, the fallback does not apply, and skipping the fan-out on a guess silently downgrades the
whole review. Attempt it first. If a call really is rejected, quote the rejection in your limitations
paragraph, work the selected angles yourself in one sequential pass under the same evidence rules, and say
plainly that the findings were reproduced by one pass rather than independently verified.

Each child is a fresh agent with no inherited context, so its prompt must carry the absolute repository
root, the resolved scope, the diff text when it is short and otherwise the exact reproduction commands with
a note that they already ran, the full definition of its own angle plus the names of the angles the other
children cover, its budget, the shared findings contract, and a scope fence allowing the enclosing
functions of changed lines and their callers and callees, and nothing wider.

## Phase 2 — Verification

This phase is what makes the command worth running. A verifier that only reads a finding and renders an
opinion is close to worthless: evaluation of frontier models on plausible-but-invalid review comments found
that they accepted most of them and caught only a small fraction of the bad ones.

1. Dedup the candidates first on the shared key: two guesses about one mechanism are one hypothesis, not
   two passes.
2. Start one fresh verifier \`subagent\` per candidate, all in a single message with
   \`run_in_background: false\`. A verifier must never be the child that produced the candidate: a finder
   defends what it found.
3. Each verifier gets the candidate, the repository root, the resolved scope, and evidence steps that must
   appear in its answer: read the hunk it points at, including the removed side; find and read every symbol
   it names; read the pre-change version of any line it calls missing; and name the triggering input, or
   say there is none.
4. Default stance: the finding is wrong. Have the verifier refute it by finding what would have to be true
   here for it to be incorrect, and keep it only if that case cannot be built.
5. Verdict first, rationale after, verdict as the first token:
   \`<label> | <the evidence command actually run> | <one-line justification>\`. A verdict with no command
   is not a verdict.
6. Never ask a verifier to review its own reasoning: ungrounded self-critique reduces accuracy, so a
   verifier's value comes from grounding alone.
7. Warn it about the most reproducible false-positive generator in diff review: a claim about what the diff
   adds, checked against a tree that lacks it, makes the symbol look absent and refutes a real finding.
   Require it to say which state it inspected.
8. The labels: \`CONFIRMED\` — the mechanism was reproduced, and the inputs producing the wrong output can
   be named and pointed at on a line. \`PLAUSIBLE\` — the mechanism is real but the trigger is uncertain:
   timing, environment, unusual input, version-specific behavior. \`REFUTED\` — a guard elsewhere, an
   impossible state, or a misread explains why it cannot happen.

9. Keep every \`CONFIRMED\`, and keep \`PLAUSIBLE\` per the level's bias rule, ranked after it, because
   dropping it would suppress the low-confidence defects this pass exists to find. Drop \`REFUTED\`, and
   print no refuted candidate unless asked.
10. Do not oversell: \`CONFIRMED\` means the finding survived one adversarial grounded pass, not that it was
    proven, so qualify a subtle one. A candidate that cannot be grounded is a stated uncertainty, not a
    loop.

## Phase 3 — Sweep (levels \`high\` and \`max\`)

Run one further \`subagent\`, framed as a **second independent reviewer** rather than a rubber stamp, hand
it the already-verified list, and tell it to look only for defects that are not on that list. A single
verification pass is weak, and it is biased by which angles ran, so the sweep is the second chance for
whatever the first pass was biased against.

Do not re-confirm what is listed, and name the angles the earlier pass covered so the sweep does not repeat
them. Run it with the same background-mode setting as the finders, because this call needs its result in
the same step too. It returns an empty result rather than padding, or \`NONE\` with a short ruled-out list. Its shape,
evidence requirement, and budget match Phase 1.

## Phase 4 — Report

Most severe first, \`CONFIRMED\` ahead of \`PLAUSIBLE\`, correctness ahead of cleanup, altitude, and
conventions. One line per finding:

\`\`\`text
<path>:<line> — <what is wrong>; <the concrete failure: which input or state produces what wrong behavior>
\`\`\`

Never bundle two problems into one item; bundling is what makes a per-finding verdict impossible. After the
list, at most a short paragraph: what was verified, and any limitation the reader needs, including the
single-pass path if the fan-out was unavailable.

If nothing survived, do not print an empty result. Print one explicit line saying no defects were found,
then a short **ruled-out list** of what was examined and why each candidate was rejected, because that list
is what separates a clean diff from a lazy review. Never pad, and never suppress a finding to look
disciplined.

## Fixing (\`--fix\`)

Apply the surviving findings, and treat a fix as a restoration rather than a redesign.

- **Reproduce what the diff removed; invent nothing.** Where a finding names the behaviour the change set
  deleted, the fix restores that behaviour exactly. Do not add a type check, an index, or a guard the
  finding did not ask for — surplus machinery is where a repair quietly changes semantics.
- **Judge behaviour on inputs the tests do not cover.** A green suite is not evidence that semantics
  survived: the suite may reach the changed path only through inputs that cannot tell the old and new
  behaviour apart, such as duplicates whose contents are identical. Compare against the pre-change code
  (\`git show HEAD:<path>\`) and reason about ordering, ties, duplicates, empty values and
  out-of-range values.
- **Re-run each finding's own trigger after fixing it, and report what it printed.** Verification after a
  fix is an observation, not an expectation. Either the call behaves as the pre-change code did, or the
  fix is not finished. Never claim a behaviour you did not observe.
- **Say what each change restores**, per finding, in the report — not merely that the suite is green.

## Non-goals

Formatting and style opinions. Subjective design taste. "Consider adding tests" without a concrete missing
case. Speculative future requirements. Refactors that belong in \`/simplify\`. Anything outside the
resolved scope.
`
