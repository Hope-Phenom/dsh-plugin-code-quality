import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, inject, name } from '../lib/index.js'
import { SKILLS } from '../lib/skills.js'

test('plugin identity matches the bundle row and the package name', () => {
  assert.equal(name, 'dsh-plugin-code-quality')
})

test('the plugin injects exactly the skill registry', () => {
  assert.deepEqual(inject, ['skills'])
})

test('apply registers every published skill on ctx.skills', () => {
  const registered = []
  const ctx = {
    skills: {
      register(skill) {
        registered.push(skill)
        return () => {}
      },
    },
  }

  apply(ctx)

  assert.deepEqual(
    registered.map((skill) => skill.name),
    SKILLS.map((skill) => skill.name),
  )
  for (const skill of registered) {
    assert.equal(skill, SKILLS.find((candidate) => candidate.name === skill.name))
  }
})

test('apply tolerates a register() that returns no disposer', () => {
  const ctx = { skills: { register: () => undefined } }
  assert.doesNotThrow(() => apply(ctx))
})
