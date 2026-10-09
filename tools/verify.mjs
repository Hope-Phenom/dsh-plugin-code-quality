#!/usr/bin/env node
/**
 * Standalone conformance report for `dsh-plugin-code-quality`.
 *
 * `node --test` owns the assertions; this script is the human-readable
 * counterpart that can run against an installed copy with no test runner and
 * no dependencies. It validates the two things that can break silently:
 *
 *   1. the skill descriptors still satisfy the `@deepseek-ai/dsh-skill`
 *      runtime-registration contract, and
 *   2. the prompt bodies still satisfy the port specification's acceptance
 *      criteria (see `docs/PORT-SPEC.md` §7).
 *
 * Exits non-zero when any check fails.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { apply, inject, name } from '../lib/index.js'
import { CODE_REVIEW_PROMPT } from '../lib/prompts/code-review.js'
import { SIMPLIFY_PROMPT } from '../lib/prompts/simplify.js'
import { CODE_REVIEW_SKILL, REVIEW_ALIAS_SKILL, SIMPLIFY_SKILL, SKILLS } from '../lib/skills.js'

/** The exact grammar `@deepseek-ai/dsh-skill` enforces on a runtime skill name. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Phrases that would make a body talk about where it came from instead of about the task. */
const LINEAGE_PHRASES = [
  /\bported from\b/iu,
  /\bported to\b/iu,
  /\bthe original (?:command|tool|implementation|version|prompt|agent)\b/iu,
  /\b(?:is|was) an? (?:port|adaptation|reimplementation|clone)\b/iu,
]

const PROMPT_FILES = [
  ['simplify', fileURLToPath(new URL('../lib/prompts/simplify.js', import.meta.url))],
  ['code-review', fileURLToPath(new URL('../lib/prompts/code-review.js', import.meta.url))],
]

const words = (text) => text.trim().split(/\s+/u).length

/** @type {Array<{ id: string, check: () => string }>} */
const checks = [
  {
    id: 'plugin/identity',
    check() {
      if (name !== 'dsh-plugin-code-quality') throw new Error(`plugin name is "${name}"`)
      if (JSON.stringify(inject) !== JSON.stringify(['skills'])) {
        throw new Error(`inject is ${JSON.stringify(inject)}`)
      }
      return `name=${name} inject=${inject.join(',')}`
    },
  },
  {
    id: 'plugin/apply',
    check() {
      const seen = []
      apply({ skills: { register: (skill) => void seen.push(skill.name) } })
      const expected = SKILLS.map((skill) => skill.name)
      if (JSON.stringify(seen) !== JSON.stringify(expected)) {
        throw new Error(`registered ${JSON.stringify(seen)} instead of ${JSON.stringify(expected)}`)
      }
      return `registered ${seen.join(', ')}`
    },
  },
  {
    id: 'skills/contract',
    check() {
      for (const skill of SKILLS) {
        if (!SKILL_NAME.test(skill.name)) throw new Error(`"${skill.name}" fails the skill-name grammar`)
        if (typeof skill.description !== 'string' || skill.description.trim() === '') {
          throw new Error(`"${skill.name}" has no description`)
        }
        if (typeof skill.content !== 'string' || skill.content.trim() === '') {
          throw new Error(`"${skill.name}" has no body`)
        }
        if (typeof skill.source !== 'string' || skill.source === '') {
          throw new Error(`"${skill.name}" has no source; validateDefinition would reject it on load`)
        }
        if (typeof skill.invocation?.modelInvocable !== 'boolean') {
          throw new Error(`"${skill.name}" has no modelInvocable policy`)
        }
        if (skill.invocation.userInvocable !== true) {
          throw new Error(`"${skill.name}" is not user-invocable, so no / command can reach it`)
        }
      }
      return `${SKILLS.length} skills satisfy the runtime-registration contract`
    },
  },
  {
    id: 'skills/policy',
    check() {
      const policy = (skill) =>
        `model=${skill.invocation.modelInvocable} user=${skill.invocation.userInvocable}`
      if (SIMPLIFY_SKILL.invocation.modelInvocable !== true) {
        throw new Error('simplify is expected to stay model-visible')
      }
      for (const skill of [CODE_REVIEW_SKILL, REVIEW_ALIAS_SKILL]) {
        if (skill.invocation.modelInvocable !== false) {
          throw new Error(`${skill.name} is expected to be user-only`)
        }
      }
      return `simplify ${policy(SIMPLIFY_SKILL)}; code-review ${policy(CODE_REVIEW_SKILL)}`
    },
  },
  {
    id: 'skills/alias',
    check() {
      if (REVIEW_ALIAS_SKILL.content !== CODE_REVIEW_SKILL.content) {
        throw new Error('/review has drifted from /code-review')
      }
      return '/review shares the /code-review body verbatim'
    },
  },
  {
    id: 'prompts/length',
    check() {
      const report = []
      for (const [label, text] of [['simplify', SIMPLIFY_PROMPT], ['code-review', CODE_REVIEW_PROMPT]]) {
        const count = words(text)
        if (count < 600) throw new Error(`${label} body is only ${count} words`)
        if (count > 2600) throw new Error(`${label} body is ${count} words`)
        report.push(`${label}=${count}w`)
      }
      return report.join(' ')
    },
  },
  {
    id: 'prompts/no-lineage-talk',
    check() {
      for (const [label, text] of [['simplify', SIMPLIFY_PROMPT], ['code-review', CODE_REVIEW_PROMPT]]) {
        for (const phrase of LINEAGE_PHRASES) {
          if (phrase.test(text)) throw new Error(`${label} body talks about its lineage via ${String(phrase)}`)
        }
      }
      return 'neither body talks about where it came from'
    },
  },
  {
    id: 'prompts/revert-boundary',
    check() {
      // Regression guard for the first end-to-end finding: /simplify must never
      // be able to undo the change set, even when the whole diff is a
      // regression and a workspace rule says the test suite must pass.
      const required = [
        [/git checkout/u, 'the forbidden git commands'],
        [/git restore/u, '`git restore`'],
        [/failing test/iu, 'the failing-test rule'],
        [/workspace rule/iu, 'the workspace-rule precedence rule'],
      ]
      for (const [pattern, what] of required) {
        if (!pattern.test(SIMPLIFY_PROMPT)) throw new Error(`simplify body is missing ${what}`)
      }
      return 'the change set cannot be undone, and a workspace rule cannot authorize it'
    },
  },
  {
    id: 'prompts/report-language',
    check() {
      // Regression guard for the bare-invocation language guess: the agent
      // produced a Spanish report for `/code-review --fix` and never mentioned
      // a reason. Also guards appended guidance being read as a review target.
      const required = [
        [/language\s+the\s+user\s+has\s+actually\s+written/iu, "the key-to-the-user's-words rule"],
        [/use\s+English rather than picking one/iu, 'the named fallback language'],
        [/guidance\s+to\s+follow, not a target to resolve/iu, 'the extra-guidance rule'],
      ]
      for (const [label, text] of [['simplify', SIMPLIFY_PROMPT], ['code-review', CODE_REVIEW_PROMPT]]) {
        for (const [pattern, what] of required) {
          if (!pattern.test(text)) throw new Error(`${label} body is missing ${what}`)
        }
      }
      return 'report language is keyed to the user with a named fallback, and extra guidance is honoured'
    },
  },
  {
    id: 'prompts/tests-are-the-spec',
    check() {
      // Regression guard for the variant-C --fix finding: a fix must not
      // rewrite a test's assertions. The run escalated to the user, which was
      // right but improvised — the body said nothing about the boundary.
      const required = [
        [/Never rewrite a test's assertion/iu, 'the no-rewriting rule'],
        [/the change is wrong, not the test/iu, 'the direction of the conflict'],
        [/list the test change as its own report item/iu, 'the disclosure requirement'],
      ]
      for (const [pattern, what] of required) {
        if (!pattern.test(CODE_REVIEW_PROMPT)) throw new Error(`code-review body is missing ${what}`)
      }
      return 'a fix may not rewrite a test, and a conflict is escalated and disclosed'
    },
  },
  {
    id: 'prompts/empty-scope',
    check() {
      // Regression guard for the clean-tree case: with an empty diff the run
      // substituted the committed root commit for the change set and edited
      // three files, changing behaviour in a command that may not.
      const required = [
        [/print one line saying nothing is changed/iu, 'the concrete stop instruction'],
        [/committed state is not a change set/iu, 'the refusal to substitute committed history'],
        [/substitute for an empty diff/iu, 'the rule against naming a revision for the user'],
      ]
      for (const [pattern, what] of required) {
        if (!pattern.test(SIMPLIFY_PROMPT)) throw new Error(`simplify body is missing ${what}`)
      }
      return 'an empty diff stops the run instead of becoming the committed history'
    },
  },
  {
    id: 'prompts/cleanup-verified-own-terms',
    check() {
      // Regression guard for the second --fix end-to-end finding: a legitimate
      // dead-code finding was refuted for having no behavioural impact, which
      // is true of every cleanup finding.
      const required = [
        [/verified on its own terms/iu, 'the separate-standard clause'],
        [/no behavioural impact/iu, 'the no-behavioural-impact rule'],
        [/every cleanup finding has none/iu, 'the reason it does not count'],
      ]
      for (const [pattern, what] of required) {
        if (!pattern.test(CODE_REVIEW_PROMPT)) throw new Error(`code-review body is missing ${what}`)
      }
      return 'a cleanup candidate is judged on whether its mechanism holds, not on behaviour'
    },
  },
  {
    id: 'prompts/no-scratch-artifacts',
    check() {
      // Regression guard for the second --fix end-to-end finding: the
      // comparison harness lived inside the tree and survived the run.
      const required = [
        [/Leave no artifacts behind/iu, 'the no-artifacts rule'],
        [/dot-directory inside the tree/iu, 'the where-scratch-goes rule'],
        [/next\s+commit/iu, 'the why-it-matters clause'],
        [/leave no scratch file behind/iu, 'the both-modes clause'],
      ]
      for (const [pattern, what] of required) {
        if (!pattern.test(CODE_REVIEW_PROMPT)) throw new Error(`code-review body is missing ${what}`)
      }
      return 'scratch harnesses stay out of the tree in both modes'
    },
  },
  {
    id: 'prompts/fanout-not-optional',
    check() {
      // Regression guard for the first /code-review end-to-end finding: the
      // agent declared the fan-out tool unavailable without issuing a single
      // call, so the finder/verifier mechanism never ran.
      const required = [
        [/tool\s+list\s+is in your context/iu, 'the visible-tool-list clause'],
        [/rejected\s+`subagent`\s+call/iu, 'the requires-an-actual-rejection clause'],
        [/never\s+issued\s+the\s+call/iu, 'the no-attempt rule'],
        [/quote\s+the\s+rejection/iu, 'the quote-the-rejection rule'],
      ]
      for (const [label, text] of [['simplify', SIMPLIFY_PROMPT], ['code-review', CODE_REVIEW_PROMPT]]) {
        for (const [pattern, what] of required) {
          if (!pattern.test(text)) throw new Error(`${label} body is missing ${what}`)
        }
      }
      return 'the fan-out cannot be skipped on a guess in either body'
    },
  },
  {
    id: 'prompts/fix-means-restore',
    check() {
      // Regression guard for the first --fix end-to-end finding: surplus
      // machinery changed dedup semantics on an input the suite could not
      // distinguish, and the post-fix "verification" claimed a behaviour the
      // code did not exhibit.
      const required = [
        [/restoration rather than a redesign/iu, 'the restoration framing'],
        [/surplus machinery/iu, 'the no-surplus-machinery rule'],
        [/git show HEAD:/u, 'the compare-against-pre-change rule'],
        [/inputs the tests do not cover/iu, 'the untested-inputs rule'],
        [/observation, not an expectation/iu, 'the observation-not-expectation rule'],
      ]
      for (const [pattern, what] of required) {
        if (!pattern.test(CODE_REVIEW_PROMPT)) throw new Error(`code-review body is missing ${what}`)
      }
      return 'a fix must restore the removed behaviour, and its verification must be an observation'
    },
  },
  {
    id: 'prompts/dsh-tooling',
    check() {
      const required = {
        simplify: [/\bsubagent\b/u, /run_in_background["'`\s:]*false/iu, /AGENTS\.md/u, /AGENTS\.local\.md/u],
        'code-review': [
          /\bsubagent\b/u,
          /run_in_background["'`\s:]*false/iu,
          /AGENTS\.md/u,
          /AGENTS\.local\.md/u,
          /\bCONFIRMED\b/u,
          /\bPLAUSIBLE\b/u,
          /\bREFUTED\b/u,
          /--fix/u,
        ],
      }
      for (const [label, patterns] of Object.entries(required)) {
        const text = label === 'simplify' ? SIMPLIFY_PROMPT : CODE_REVIEW_PROMPT
        for (const pattern of patterns) {
          if (!pattern.test(text)) throw new Error(`${label} body is missing ${String(pattern)}`)
        }
      }
      return 'subagent fan-out, background mode, instruction files and verdict labels all present'
    },
  },
  {
    id: 'prompts/instruction-files',
    check() {
      /** The only instruction-file names a body may mention. */
      const allowed = new Set(['AGENTS.md', 'AGENTS.local.md'])
      for (const [label, text] of [['simplify', SIMPLIFY_PROMPT], ['code-review', CODE_REVIEW_PROMPT]]) {
        for (const name of new Set(text.match(/[A-Za-z0-9_.-]*\.md/gu) ?? [])) {
          if (!allowed.has(name)) throw new Error(`${label} body names the instruction file ${name}`)
        }
      }
      return 'both bodies stay on the AGENTS-family instruction names'
    },
  },
  {
    id: 'prompts/angles',
    check() {
      for (const angle of ['Reuse', 'Simplification', 'Efficiency', 'Altitude']) {
        if (!SIMPLIFY_PROMPT.includes(angle)) throw new Error(`simplify body is missing ${angle}`)
      }
      return 'Reuse / Simplification / Efficiency / Altitude are all labelled'
    },
  },
  {
    id: 'prompts/framing',
    check() {
      for (const [label, text] of [['simplify', SIMPLIFY_PROMPT], ['code-review', CODE_REVIEW_PROMPT]]) {
        for (const tag of ['<skill_instructions>', '<skill_content>', '<system-reminder>']) {
          if (text.includes(tag)) throw new Error(`${label} body emits ${tag}`)
        }
        if (/\p{Extended_Pictographic}/u.test(text)) throw new Error(`${label} body contains an emoji`)
      }
      return 'no host-owned framing tags and no emoji'
    },
  },
  {
    id: 'prompts/files',
    check() {
      const report = []
      for (const [label, path] of PROMPT_FILES) {
        const raw = readFileSync(path, 'utf8')
        if (raw.includes('\r')) throw new Error(`${label} prompt file contains CR`)
        if (!raw.endsWith('\n') || raw.endsWith('\n\n')) {
          throw new Error(`${label} prompt file must end with exactly one newline`)
        }
        const offenders = raw
          .split('\n')
          .map((line, index) => [index + 1, line])
          .filter(([, line]) => /[ \t]+$/u.test(line))
        if (offenders.length > 0) {
          throw new Error(`${label} prompt file has trailing whitespace on line ${offenders[0][0]}`)
        }
        report.push(`${label}=${raw.length}B`)
      }
      return report.join(' ')
    },
  },
]

let failed = 0
for (const { id, check } of checks) {
  try {
    const detail = check()
    console.log(`PASS  ${id.padEnd(24)} ${detail}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${id.padEnd(24)} ${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
