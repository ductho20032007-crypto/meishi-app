// Error kind (from github.js / gemini.js / repo.js) -> i18n key under "errors.*".
export const ERROR_KINDS = ['auth', 'repomissing', 'notfound', 'ratelimit', 'server', 'network', 'region', 'bad_request', 'quota', 'busy', 'timeout']
export const errorKey = kind => `errors.${ERROR_KINDS.includes(kind) ? kind : 'other'}`
