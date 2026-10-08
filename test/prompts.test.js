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
    assert.ok(words <= 2200, `${label} body is ${words} words, over the budget`)
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
