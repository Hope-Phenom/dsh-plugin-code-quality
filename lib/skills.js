/**
 * Skill descriptors published by `dsh-plugin-code-quality`.
 *
 * Every entry is a *runtime* skill: the registry fills in the `runtime`
 * provider label, and the explicit `source` keeps the loaded definition valid
 * (`validateDefinition` requires a string source on load).
 *
 * Invocation policy is the interesting part of this table:
 *
 * - `simplify` is visible to the model as well as the user. It is a safe,
 *   behaviour-preserving cleanup pass, so letting the model reach for it on
 *   its own is reasonable.
 * - `code-review` and its `review` alias are user-only. DSH renders a
 *   `modelInvocable: false` skill in the `/` menu with a user-only marker, and
 *   that path is its only entry point — the model never sees it in its skill
 *   catalog and cannot trigger it by itself.
 *
 * DSH has no skill-alias mechanism: `dsh-skill` keys a runtime registration by
 * `name` alone (localized aliases exist only for host *commands*, selected by
 * a first-party `definitionId`). `/review` is therefore a second registration
 * that shares the `code-review` body rather than a pointer to it.
 *
 * @module dsh-plugin-code-quality/skills
 */

import { CODE_REVIEW_PROMPT } from './prompts/code-review.js'
import { SIMPLIFY_PROMPT } from './prompts/simplify.js'

/** Source label recorded on every skill this plugin registers. */
export const PROVIDER_SOURCE = 'dsh-plugin-code-quality'

/** Shared invocation policy for the two user-only skills. */
const USER_ONLY = Object.freeze({ modelInvocable: false, userInvocable: true })

/** `/simplify` — model- and user-invocable. */
export const SIMPLIFY_SKILL = Object.freeze({
  name: 'simplify',
  description:
    'Clean up the code you changed: reuse helpers that already exist, drop needless complexity, cut wasted work, and re-seat changes made at the wrong layer — all without changing behaviour. Not a bug hunt.',
  invocation: Object.freeze({ modelInvocable: true, userInvocable: true }),
  source: PROVIDER_SOURCE,
  content: SIMPLIFY_PROMPT,
})

/** `/code-review` — user-invocable only. */
export const CODE_REVIEW_SKILL = Object.freeze({
  name: 'code-review',
  description:
    'Find real correctness bugs in the current diff: independent review angles fan out, every candidate is verified before it is reported, and a final sweep looks only for what the first pass missed.',
  invocation: USER_ONLY,
  source: PROVIDER_SOURCE,
  content: CODE_REVIEW_PROMPT,
})

/**
 * `/review` — alias of `/code-review`.
 *
 * A separate registration because the skill surface is keyed by name; the body
 * is the same string, so the two entry points cannot drift.
 */
export const REVIEW_ALIAS_SKILL = Object.freeze({
  name: 'review',
  description: 'Alias for /code-review — identical behaviour, identical instructions.',
  invocation: USER_ONLY,
  source: PROVIDER_SOURCE,
  content: CODE_REVIEW_PROMPT,
})

/** Every skill this plugin publishes, in `/`-menu order. */
export const SKILLS = Object.freeze([SIMPLIFY_SKILL, CODE_REVIEW_SKILL, REVIEW_ALIAS_SKILL])
