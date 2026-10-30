// dsh-session-inbox — host half.
//
// One job: register the `sessionInbox` session projection, a pure fold of the
// committed session log into "when did this conversation last finish a turn, and
// how". The client reads it per session as `projectionValues.sessionInbox` to
// build the panel's recent-completions feed.
//
// Nothing is inferred on the host, no session event is written, and no tool is
// registered: every other fact the panel shows is already computed by the client
// runtime (sessions list + session status).

/** The wire/state value before any turn finished. */
const EMPTY = Object.freeze({ turn: 0, time: 0, reason: '' })

/**
 * The projection seam validates with `schema.parse(value)`. This plugin ships no
 * schema dependency, and the value shape is fixed by its own `view` (three
 * primitive fields), so parsing is identity.
 */
const identitySchema = Object.freeze({ parse: (value) => value })

export const name = 'dsh-session-inbox'

/** The projection registry must exist before this row activates. */
export const inject = ['sessionProjections']

/**
 * Fold one committed event. Only `turn/end` carries a completion; every other
 * event returns the same reference, which is what gates the change feed.
 * @param state current fold state.
 * @param event next committed session event.
 */
function applyEvent(state, event) {
  if (event === null || event === undefined || event.type !== 'turn/end') return state
  const data = event.data
  if (data === null || data === undefined || typeof data.turn !== 'number') return state
  const reason = data.reason !== null && data.reason !== undefined && typeof data.reason.kind === 'string'
    ? data.reason.kind
    : ''
  const time = typeof event.time === 'number' ? event.time : 0
  if (state.turn === data.turn && state.time === time && state.reason === reason) return state
  return { turn: data.turn, time, reason }
}

/**
 * Resolve one service by key, falling back to the context property.
 * @param ctx host plugin context.
 * @param key service key.
 */
function serviceOf(ctx, key) {
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get(key) : undefined
    if (viaGet !== undefined && viaGet !== null) return viaGet
  } catch (err) {
    /* fall through to the property probe */
  }
  try {
    return ctx[key]
  } catch (err) {
    return undefined
  }
}

export function apply(ctx) {
  const projections = serviceOf(ctx, 'sessionProjections')
  if (!projections || typeof projections.register !== 'function') {
    console.warn('[dsh-session-inbox] sessionProjections unavailable — recent completions will stay empty')
    return
  }
  ctx.effect(() => projections.register({
    key: 'sessionInbox',
    stateSchema: identitySchema,
    init: () => EMPTY,
    apply: applyEvent,
    wire: { viewSchema: identitySchema, view: (state) => state },
    stateVersion: 1,
  }), 'dsh-session-inbox: sessionInbox projection')
}
