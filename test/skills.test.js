import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CODE_REVIEW_SKILL,
  PROVIDER_SOURCE,
  REVIEW_ALIAS_SKILL,
  SIMPLIFY_SKILL,
  SKILLS,
} from '../lib/skills.js'

/** The exact grammar `@deepseek-ai/dsh-skill` enforces on a runtime skill name. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

test('the table publishes both ported commands plus the review alias', () => {
  assert.deepEqual(
    SKILLS.map((skill) => skill.name),
    ['simplify', 'code-review', 'review'],
  )
})

test('every entry satisfies the DSH runtime-skill contract', () => {
  for (const skill of SKILLS) {
    assert.match(skill.name, SKILL_NAME, `${skill.name} must match the skill-name grammar`)
    assert.ok(skill.description.trim().length > 0, `${skill.name} needs a description`)
    assert.ok(skill.content.trim().length > 0, `${skill.name} needs a body`)
    // `validateDefinition` rejects a loaded skill whose `source` is not a string.
    assert.equal(skill.source, PROVIDER_SOURCE)
    assert.equal(typeof skill.invocation.modelInvocable, 'boolean')
    assert.equal(typeof skill.invocation.userInvocable, 'boolean')
    assert.equal(skill.invocation.userInvocable, true, `${skill.name} must be user-invocable`)
  }
})

test('skill names are unique so no registration is silently first-wins', () => {
  const names = SKILLS.map((skill) => skill.name)
  assert.equal(new Set(names).size, names.length)
})

test('invocation policy is user-only for code-review and dual for simplify', () => {
  assert.deepEqual(SIMPLIFY_SKILL.invocation, { modelInvocable: true, userInvocable: true })
  assert.deepEqual(CODE_REVIEW_SKILL.invocation, { modelInvocable: false, userInvocable: true })
  assert.deepEqual(REVIEW_ALIAS_SKILL.invocation, { modelInvocable: false, userInvocable: true })
})

test('the review alias cannot drift from the command it aliases', () => {
  assert.equal(REVIEW_ALIAS_SKILL.content, CODE_REVIEW_SKILL.content)
})

test('registered values are frozen so the registry cannot mutate them', () => {
  assert.ok(Object.isFrozen(SKILLS))
  for (const skill of SKILLS) {
    assert.ok(Object.isFrozen(skill), `${skill.name} must be frozen`)
    assert.ok(Object.isFrozen(skill.invocation), `${skill.name} invocation must be frozen`)
  }
})
