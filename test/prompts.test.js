import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { CODE_REVIEW_PROMPT } from '../lib/prompts/code-review.js'
import { SIMPLIFY_PROMPT } from '../lib/prompts/simplify.js'

const SIMPLIFY_PATH = fileURLToPath(new URL('../lib/prompts/simplify.js', import.meta.url))
const CODE_REVIEW_PATH = fileURLToPath(new URL('../lib/prompts/code-review.js', import.meta.url))

/** Both bodies, labelled, for the checks that apply to each of them. */
const BODIES = [
  { label: 'simplify', text: SIMPLIFY_PROMPT },
  { label: 'code-review', text: CODE_REVIEW_PROMPT },
]

/** Phrases that would make a body talk about where it came from instead of about the task. */
const LINEAGE_PHRASES = [
  /\bported from\b/iu,
  /\bported to\b/iu,
  /\bthe original (?:command|tool|implementation|version|prompt|agent)\b/iu,
  /\b(?:is|was) an? (?:port|adaptation|reimplementation|clone)\b/iu,
]

function wordCount(text) {
  return text.trim().split(/\s+/u).length
}

test('both bodies are substantial documents, not stubs', () => {
  for (const { label, text } of BODIES) {
    const words = wordCount(text)
    assert.ok(words >= 600, `${label} body is only ${words} words`)
    assert.ok(words <= 2600, `${label} body is ${words} words, over the budget`)
  }
})

test('neither body talks about its own lineage', () => {
  for (const { label, text } of BODIES) {
    for (const phrase of LINEAGE_PHRASES) {
      assert.doesNotMatch(text, phrase, `${label} body talks about its lineage via ${String(phrase)}`)
    }
  }
})

/** The only instruction-file names a body may mention. */
const ALLOWED_INSTRUCTION_FILES = new Set(['AGENTS.md', 'AGENTS.local.md'])

test('both bodies reference only the AGENTS-family instruction files', () => {
  for (const { label, text } of BODIES) {
    assert.match(text, /AGENTS\.md/u, `${label} body must name AGENTS.md`)
    assert.match(text, /AGENTS\.local\.md/u, `${label} body must name AGENTS.local.md`)

    // Collect every `.md` name the body mentions and require it to be one of
    // ours: the prompts stay on the neutral AGENTS names instead of teaching a
    // second configuration layout.
    const named = text.match(/[A-Za-z0-9_.-]*\.md/gu) ?? []
    const unexpected = [...new Set(named)].filter((name) => !ALLOWED_INSTRUCTION_FILES.has(name))
    assert.deepEqual(unexpected, [], `${label} body names instruction files outside the AGENTS family`)
  }
})

test('the code-review body keeps scratch artifacts out of the repository', () => {
  // Found by the second --fix end-to-end run: the comparison harness the new
  // restore rule encourages was left in the tree as an untracked `.verify/`
  // directory, which the user's next commit would have picked up.
  const required = [
    [/Leave no artifacts behind/iu, 'the no-artifacts rule'],
    [/dot-directory inside the tree/iu, 'the where-scratch-goes rule'],
    [/next\s+commit/iu, 'the why-it-matters clause'],
    [/leave no scratch file behind/iu, 'the both-modes clause'],
  ]
  for (const [pattern, what] of required) {
    assert.ok(pattern.test(CODE_REVIEW_PROMPT), `code-review body is missing ${what}`)
  }
})

test('the simplify body refuses to invent a change set from committed history', () => {
  // Found by the clean-tree case. With no derivable range the run treated a
  // single committed root commit as "the code you changed", edited three files
  // (one of them outside any change set) and changed observable behaviour —
  // in a command whose contract forbids behaviour changes.
  const required = [
    [/print one line saying nothing is changed/iu, 'the concrete stop instruction'],
    [/committed state is not a change set/iu, 'the refusal to substitute committed history'],
    [/substitute for an empty diff/iu, 'the rule against naming a revision for the user'],
  ]
  for (const [pattern, what] of required) {
    assert.ok(pattern.test(SIMPLIFY_PROMPT), `simplify body is missing ${what}`)
  }
})

test('both bodies key the report language to the user and state a fallback', () => {
  // Found by a --fix run whose user had typed only `/code-review --fix`: with
  // no language in the message to read, the agent picked Spanish and never
  // mentioned it. Also covers appended guidance — `/code-review --fix 用中文汇报`
  // — which the scope contract used to treat as a possible review target.
  for (const { label, text } of BODIES) {
    assert.ok(
      /language\s+the\s+user\s+has\s+actually\s+written/iu.test(text),
      `${label} must key the report language to the user's own words`,
    )
    assert.ok(
      /use\s+English rather than picking one/iu.test(text),
      `${label} must name the fallback language instead of leaving it to a guess`,
    )
    assert.ok(
      /guidance\s+to\s+follow, not a target to resolve/iu.test(text),
      `${label} must accept extra guidance in the message`,
    )
  }
})

test('the code-review body forbids rewriting a test to match a fix', () => {
  // Found by the variant-C --fix run: a project rule generalised further than
  // an existing test did, and the agent escalated to the user. Correct — but
  // improvised, because nothing in the body said the boundary existed, so the
  // next run could equally have rewritten the test silently.
  const required = [
    [/Never rewrite a test's assertion/iu, 'the no-rewriting rule'],
    [/the change is wrong, not the test/iu, 'the direction of the conflict'],
    [/list the test change as its own report item/iu, 'the disclosure requirement'],
  ]
  for (const [pattern, what] of required) {
    assert.ok(pattern.test(CODE_REVIEW_PROMPT), `code-review body is missing ${what}`)
  }
})

test('the code-review body gives cleanup candidates their own verification standard', () => {
  // Found by the second --fix end-to-end run: a verifier confirmed a dead
  // constant was unreferenced, then dropped it for having "no behavioural
  // impact" — which is true of every cleanup finding. The verdict labels were
  // defined only in terms of wrong output, so no cleanup candidate could ever
  // be CONFIRMED.
  const required = [
    [/verified on its own terms/iu, 'the separate-standard clause'],
    [/no behavioural impact/iu, 'the no-behavioural-impact rule'],
    [/every cleanup finding has none/iu, 'the reason it does not count'],
  ]
  for (const [pattern, what] of required) {
    assert.ok(pattern.test(CODE_REVIEW_PROMPT), `code-review body is missing ${what}`)
  }
})

test('the simplify body closes the revert escape hatch', () => {
  // Found by the first end-to-end run: given a diff whose every change was a
  // regression and a workspace rule saying the test suite must pass, the agent
  // reasoned that "restoring HEAD is the simplification" and undid the change
  // set. These clauses are the fix, so they are load-bearing.
  assert.match(SIMPLIFY_PROMPT, /git checkout/u, 'must name the git commands it forbids')
  assert.match(SIMPLIFY_PROMPT, /git restore/u, 'must name `git restore` among the forbidden actions')
  assert.match(SIMPLIFY_PROMPT, /failing test/iu, 'must rule out repairing a failing test')
  assert.match(SIMPLIFY_PROMPT, /workspace rule/iu, 'must say a workspace rule does not widen the remit')
})

test('the code-review body defines what fixing means', () => {
  // Found by the first --fix end-to-end run: it rewrote a dedup loop with
  // surplus machinery (a Map index it did not need), flipping duplicate-id
  // handling from first-wins to last-wins on an input the suite could not
  // distinguish, and then reported "non-string-name records are kept" as a
  // verification result while the code still dropped them.
  const required = [
    [/restoration rather than a redesign/iu, 'the restoration framing'],
    [/surplus machinery/iu, 'the no-surplus-machinery rule'],
    [/git show HEAD:/u, 'the compare-against-pre-change rule'],
    [/inputs the tests do not cover/iu, 'the untested-inputs rule'],
    [/observation, not an expectation/iu, 'the observation-not-expectation rule'],
  ]
  for (const [pattern, what] of required) {
    assert.ok(pattern.test(CODE_REVIEW_PROMPT), `code-review body is missing ${what}`)
  }
})

test('neither body lets the agent assume the fan-out tool is missing', () => {
  // Found by the first /code-review end-to-end run: `subagent` was in the
  // session's tool list (27 tools), the agent issued zero subagent calls, and
  // its report claimed the fan-out "was not available in this session" — so
  // the finder/verifier mechanism never ran. The old fallback clause was the
  // loophole: it offered a cheaper sequential path behind a condition the
  // agent never checked.
  for (const { label, text } of BODIES) {
    const required = [
      [/tool\s+list\s+is in your context/iu, 'must say the tool list is visible'],
      [/rejected\s+`subagent`\s+call/iu, 'must require an actual rejection'],
      [/never\s+issued\s+the\s+call/iu, 'must rule out the no-attempt fallback'],
      [/quote\s+the\s+rejection/iu, 'must require the rejection to be quoted'],
    ]
    for (const [pattern, why] of required) {
      // assert.ok rather than assert.match: a failure should print one line,
      // not the whole prompt body.
      assert.ok(pattern.test(text), `${label} body ${why}`)
    }
  }
})

test('both bodies use the DSH subagent tool and pin same-step fan-out', () => {
  for (const { label, text } of BODIES) {
    assert.match(text, /subagent/u, `${label} body must name the subagent tool`)
    assert.match(text, /run_in_background/u, `${label} body must pin the fan-out background mode`)
    assert.match(text, /run_in_background["'`\s:]*false/iu, `${label} body must require run_in_background: false`)
  }
})

test('both bodies tell the agent to answer in the user\'s language', () => {
  for (const { label, text } of BODIES) {
    assert.match(text, /language/iu, `${label} body must state the report language rule`)
  }
})

test('the simplify body names all four cleanup angles', () => {
  for (const angle of ['Reuse', 'Simplification', 'Efficiency', 'Altitude']) {
    assert.match(SIMPLIFY_PROMPT, new RegExp(angle, 'u'), `simplify body is missing the ${angle} angle`)
  }
})

test('the code-review body carries the verification contract', () => {
  for (const label of ['CONFIRMED', 'PLAUSIBLE', 'REFUTED']) {
    assert.match(CODE_REVIEW_PROMPT, new RegExp(`\\b${label}\\b`, 'u'), `code-review body is missing ${label}`)
  }
})

test('the code-review body grounds verification in evidence and a refutation stance', () => {
  assert.match(CODE_REVIEW_PROMPT, /evidence/iu, 'code-review body must require an evidence field')
  assert.match(
    CODE_REVIEW_PROMPT,
    /refut|disprov|falsif/iu,
    'code-review body must tell the verifier to try to refute the finding',
  )
})

test('both bodies require an evidence trail from the finders', () => {
  for (const { label, text } of BODIES) {
    assert.match(text, /evidence/iu, `${label} body must require the finder's evidence field`)
  }
})

test('the code-review body documents the --fix opt-in', () => {
  assert.match(CODE_REVIEW_PROMPT, /--fix/u)
})

test('neither body opens its own prompt framing', () => {
  for (const { label, text } of BODIES) {
    for (const tag of ['<skill_instructions>', '<skill_content>', '<system-reminder>', '<system_reminder>']) {
      assert.ok(!text.includes(tag), `${label} body must not emit ${tag}; the host owns that framing`)
    }
  }
})

test('neither body uses emoji', () => {
  for (const { label, text } of BODIES) {
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `${label} body contains an emoji`)
  }
})

test('both bodies keep headings and code fences clear of surrounding prose', () => {
  const files = [
    ['simplify', SIMPLIFY_PATH],
    ['code-review', CODE_REVIEW_PATH],
  ]

  for (const [label, path] of files) {
    const lines = readFileSync(path, 'utf8').split('\n')
    let inFence = false

    lines.forEach((line, index) => {
      const previous = lines[index - 1]
      const next = lines[index + 1]
      const isFence = /^```/u.test(line)
      const isHeading = /^#{1,6}\s/u.test(line)

      if (isFence) {
        if (inFence) {
          // closing delimiter: prose must not resume on the very next line
          if (next !== undefined && next.trim() !== '') {
            assert.fail(`${label}: closing fence on line ${index + 1} needs a blank line after it`)
          }
          inFence = false
        } else {
          if (previous !== undefined && previous.trim() !== '') {
            assert.fail(`${label}: opening fence on line ${index + 1} needs a blank line before it`)
          }
          inFence = true
        }
        return
      }

      if (inFence) return

      if (isHeading) {
        if (previous !== undefined && previous.trim() !== '') {
          assert.fail(`${label}: heading on line ${index + 1} needs a blank line before it`)
        }
        if (next !== undefined && next.trim() !== '') {
          assert.fail(`${label}: heading on line ${index + 1} needs a blank line after it`)
        }
      }
    })
  }
})

test('both prompt modules are shipped with LF endings, one trailing newline, and no CR', () => {
  for (const [label, path] of [['simplify', SIMPLIFY_PATH], ['code-review', CODE_REVIEW_PATH]]) {
    const raw = readFileSync(path, 'utf8')
    assert.ok(!raw.includes('\r'), `${label} prompt file contains CR`)
    assert.ok(raw.endsWith('\n'), `${label} prompt file must end with a newline`)
    assert.ok(!raw.endsWith('\n\n'), `${label} prompt file must end with exactly one newline`)
    const trailingWhitespace = raw
      .split('\n')
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => /[ \t]+$/u.test(line))
    assert.deepEqual(trailingWhitespace, [], `${label} prompt file has trailing whitespace`)
  }
})
