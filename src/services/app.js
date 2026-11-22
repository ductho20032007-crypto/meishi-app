// Wires real instances from the stored config, lazily. Call resetApp() after setup / clearing keys.
import { db } from './db.js'
import { getConfig } from './settings.js'
import { createGitHub } from './github.js'
import { createGemini } from './gemini.js'
import { createSync } from './sync.js'
import { createRepo } from './repo.js'

let app = null
export function getApp() {
  if (!app) {
    const cfg = getConfig()
    const gh = createGitHub({ token: cfg.gh, repo: cfg.repo })
    const gemini = createGemini({ key: cfg.gk, model: cfg.model })
    const sync = createSync({ db, gh })
    app = { db, gh, gemini, sync, repo: createRepo({ db, sync, gemini }) }
  }
  return app
}
export function resetApp() { app = null }
