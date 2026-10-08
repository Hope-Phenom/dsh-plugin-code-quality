/**
 * Host entry for `dsh-plugin-code-quality`.
 *
 * The plugin owns no service, no tool, no prompt section and no HTTP route: it
 * only publishes user-invocable skills onto `ctx.skills`, so the whole feature
 * is reachable from the Web composer's `/` menu without a client half. See
 * `README.md` for why the skill surface — not `ctx.commands` — is the faithful
 * substrate for these two ported commands.
 *
 * @module dsh-plugin-code-quality
 */

import { SKILLS } from './skills.js'

/** Cordis plugin name. */
export const name = 'dsh-plugin-code-quality'

/**
 * The skill registry is the only service required. With this injection the
 * plugin starts only once `ctx.skills` exists, and every registration unwinds
 * with the plugin's own fiber.
 */
export const inject = ['skills']

/**
 * Register both ported commands (and the `/review` alias) as runtime skills.
 *
 * `ctx.skills.register()` files each registration into the calling context's
 * layer, so a host row lands in the global layer and every agent in every
 * preset sees the same catalog. A duplicate name in one layer is first-wins
 * with a warning, which keeps two rows of this plugin from throwing during an
 * HMR reload.
 *
 * @param ctx - the Cordis context carrying `ctx.skills`.
 */
export function apply(ctx) {
  for (const skill of SKILLS) ctx.skills.register(skill)
}
