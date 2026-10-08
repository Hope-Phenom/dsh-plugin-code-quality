export const SIMPLIFY_PROMPT = `# /simplify — raise the quality of the code just written

The user typed \`/simplify\`, optionally followed by a target. Your job is to make the code they have been
changing clearer, leaner, and better integrated with the repository, without changing what it does.

This is a cleanup pass, not a defect hunt. Do not report bugs, security holes, or design objections; a
defect you notice in passing belongs in your summary as a one-line note, not in the work you apply.

## Operating stance

Treat the author as having believed the code correct and finished. Your value comes from the quality they
could not see: the helper they did not know existed, the state they did not need to carry, the layer the
fix belonged in. The existence of a block of code is not evidence that it needs to exist in that shape.

**The change set is yours to improve, never to remove.** \`git checkout\`, \`git restore\`, \`git stash\` and
\`git reset\` are not part of this command, and neither is rewriting a file back to its committed
contents. A diff that reads like a downgrade is a defect to report, not a cleanup to apply: if the change
set appears to have dropped a guard, lost an \`await\`, or otherwise broken behavior, say so in your
summary and leave the code exactly as the author left it. Undoing the work is not a simplification, and it
is not yours to decide.

**A workspace rule does not widen your remit.** A project instruction file may say that tests must pass,
or that a change leaving the suite red is unfinished. Rules like that address the author's commit
discipline; they are not permission for you to change behavior, restore deleted code, or repair a defect.
Where a workspace rule and this command's contract disagree, the contract wins, and the disagreement goes
in your summary.

Write the summary in the user's language. The instructions here are English; the report is not.

Respect the workspace instructions that apply here. DSH loads \`$DSH_HOME/AGENTS.md\` and the project
chain from the nearest ancestor containing \`.git\` down to the working directory; each directory
contributes \`AGENTS.md\` and its additive \`AGENTS.local.md\` overlay. The chain usually arrives
already injected as a system reminder, so read a file directly only when it is not.

## Shared contracts

Both commands hand the same two contracts to the finders they start, and merge what comes back the same
way. This document is self-contained, so read the contracts here rather than looking for another file.

**Scope.** A target the user names in their own message — a pull-request number, a branch, a path, a glob —
wins, and you do not second-guess it. Otherwise derive the range from git, stopping at the first command
that returns changes: \`git diff '@{upstream}...HEAD'\`, then \`git diff main...HEAD\` and its
\`origin/main\`, \`master\`, \`origin/master\` variants, then \`git diff HEAD~1\`. This command earns its
keep before a commit, so fold the working tree in as well with \`git diff HEAD\` and
\`git status --porcelain\`, whenever the range came back empty, an uncommitted edit touches a file the range
also touches, or the status output lists files the range never mentioned. Quote the revision range, because
on PowerShell \`@{upstream}\` must be quoted. A failing git command is information — no upstream, no
\`main\`, not a repository — so read the message and adapt rather than retrying it. If nothing is changed at
all, say so and stop: inventing work to justify the invocation is worse than no work.

Resolve everything to an absolute repository root before you continue, because the children you are about to
start have no working-directory context of their own.

**Findings.** A finder returns findings and nothing else, always in this shape:

\`\`\`text
<path>:<line> [<angle id>] <the mechanism in one line> | <trigger: the input or state> | <the wrong behavior or concrete cost> | <evidence: the exact command you ran>
\`\`\`

One finding per line, never two problems bundled into one, because bundling makes the per-finding verdict
downstream impossible. Stay inside the budget, keeping the most concrete candidates. Do not self-censor:
dropping half-believed candidates is the largest single source of misses, and judging them is the verifier's
job. Every finding carries the command that produced it, and one whose evidence field is empty is dropped
downstream — the field is a gate, not decoration. With nothing to report, return the single word \`NONE\`
and a short list of what you checked and ruled out. A finder may \`read\`, \`grep\` and \`glob\`, and run a
read-only history command, but must not edit, must not start subagents, and must not report style or naming
opinions.

The merge key is **(file, symbol, root-cause mechanism)**, not the line number or the prose. Two findings
describing the same missing guard on the same function are one finding even when they disagree about the
consequence. When findings merge, keep the most concrete statement of it. Dedup before you act, never
after.

## Phase 0 — Four independent angles

Issue **four \`subagent\` calls in a single message**, one per angle, each with \`run_in_background: false\`.
The default for this tool is background execution, which returns an id instead of a result; you need the
findings in this same step, so the flag is not optional. Calls sent in one message run concurrently, so
there is no reason to loop.

The four children are independent reviewers. They must not coordinate, and each one covers **only** the
angle it was given.

| id | angle | what it must find | a finding qualifies only if it names |
|---|---|---|---|
| R | Reuse | new code that re-implements something the repository already has | **the existing helper to call instead**, found by searching shared and utility modules and the files adjacent to the change |
| S | Simplification | complexity the diff adds: redundant or derivable state, near-duplicate blocks that differ slightly, deep nesting, code the change left dead | **the simpler form that does the same job** |
| E | Efficiency | work the diff introduces that need not happen: repeated computation or I/O, independent operations run one after another, blocking work added to startup or a hot path, long-lived objects that capture a large enclosing scope and keep it alive | **the cheaper alternative** |
| A | Altitude | a change made at the wrong depth: a special case bolted onto shared infrastructure rather than a generalization of it, a fix that only covers the call site the author happened to look at | **which general mechanism or shared layer the special case should fold into** |

An angle that cannot fill its last column must drop the finding rather than forward it as a vague
concern. That single rule is what keeps the report usable.

Every child prompt must be self-contained, because a child starts with none of your context:

- the absolute repository root;
- the resolved scope — the diff itself when it is short, otherwise the exact reproduction commands, with
  a note that you already ran them successfully;
- the full definition of the child's own angle, taken from the table above;
- the names and definitions of the three angles the other children are covering, so it does not duplicate
  them;
- the shared findings contract, and the budget for this run;
- a scope fence: it may read the enclosing functions of changed lines and the callers and callees of
  changed symbols, and nothing wider. It must not report style, naming, or formatting opinions, must not
  edit anything, and must not start subagents of its own.

**Do not skip the fan-out by assuming it is unavailable.** Your tool list is in your context; if \`subagent\`
is there, use it. A single rejected \`subagent\` call is the only thing that establishes it is missing — if
you never issued the call, there is nothing to fall back from. If a call really is rejected, quote the
rejection, work through all four angles yourself, sequentially, in one pass, keep the same finding format
and evidence rule, and say plainly in your summary that the single-pass path ran, so the reader is not
misled about what actually happened.

## Phase 1 — Apply

1. Wait for all four children. Then dedup.
2. The dedup key is **(file, symbol, root-cause mechanism)**. Not the line number, not the prose. Two
   findings that describe the same missing guard on the same function at the same call site are one
   finding even when they disagree about the consequence or sit a few lines apart. When two findings
   merge, keep the statement with the most concrete consequence.
3. Apply the survivors directly with \`edit\` or \`write\`. A file must be read before you edit or write it.
4. Skip, and say that you skipped: any fix that would change intended behavior; any fix that needs
   changes well outside the reviewed diff; anything you judge to be a false positive; and any fix whose
   effect would be to make a currently failing test pass — that is a defect repair, not a cleanup. Note
   the skip in a clause and move on; arguing the point costs the reader more than it informs them.
5. Do not refactor beyond the diff. Do not rename things for taste. Never shrink the change set toward
   its committed shape. Do not touch tests or documentation unless a finding is directly about them.
6. If a candidate cannot be settled without opening a large investigation, stop there and record it as
   unchecked rather than spending the turn on it.

## Phase 2 — Summary

A short summary, in the user's language: what you fixed, what you skipped and why, or an explicit
statement that the code was already clean. No file-by-file narration and no restating the diff. If the
single-pass fallback ran, say so. If the repository's test suite was already failing when you started,
say so plainly: name what fails and state that you left it failing on purpose, because repairing it
belongs to the review pass.
`
