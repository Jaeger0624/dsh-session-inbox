// dsh-session-activity — host half.
//
// One job: register the `sessionActivity` session projection, a pure fold of the
// committed session log into "when did this conversation last finish a turn, and
// how". The client reads it per session as `projectionValues.sessionActivity` to
// build the panel's recent-completions list; nothing else is inferred here, no
// session event is written, and no tool is registered.
//
// It also owns one tiny reporting route (DIAGNOSTICS) because a crashed slot
// occupant is invisible in the browser and the Harness UI has no host-side way
// to read a client error:
//   [dsh-session-activity] client stage=load
//   [dsh-session-activity] client stage=apply list=1 status=1
//   [dsh-session-activity] client stage=render rows=3 pending=1 running=1 done=1 statusSource=1
//   [dsh-session-activity] client stage=crash message=...

const ROUTE = '/dsh-session-activity/report'

/** Keep the reporting route on while the panel is being brought up. */
const DIAGNOSTICS = true

/** The wire/state value before any turn finished. */
const EMPTY = Object.freeze({ turn: 0, time: 0, reason: '' })

/**
 * The projection seam validates with `schema.parse(value)`. This plugin ships no
 * schema dependency, and the value shape is fixed by its own `view` (three
 * primitive fields), so parsing is identity.
 */
const identitySchema = Object.freeze({ parse: (value) => value })

export const name = 'dsh-session-activity'

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
 * Resolve one optional service without making the whole row depend on it.
 * @param ctx host plugin context.
 * @param key service key.
 */
function serviceOf(ctx, key) {
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get(key) : undefined
    if (viaGet !== undefined && viaGet !== null) return viaGet
  } catch (err) {
    /* fall through */
  }
  try {
    return ctx[key]
  } catch (err) {
    return undefined
  }
}

/** Write one line to the host log (the dsh-web stdout capture). */
function log(ctx, line) {
  try {
    if (ctx.logger && typeof ctx.logger.info === 'function') {
      ctx.logger.info(line)
      return
    }
  } catch (err) {
    /* fall through to stdout */
  }
  console.log(line)
}

export function apply(ctx) {
  const projections = serviceOf(ctx, 'sessionProjections')
  if (projections && typeof projections.register === 'function') {
    ctx.effect(() => projections.register({
      key: 'sessionActivity',
      stateSchema: identitySchema,
      init: () => EMPTY,
      apply: applyEvent,
      wire: { viewSchema: identitySchema, view: (state) => state },
      stateVersion: 1,
    }), 'dsh-session-activity: sessionActivity projection')
    log(ctx, '[dsh-session-activity] host half active — sessionActivity projection registered')
  } else {
    log(ctx, '[dsh-session-activity] sessionProjections unavailable — recent completions will be empty')
  }

  if (DIAGNOSTICS !== true) return
  const server = serviceOf(ctx, 'webServer')
  if (!server || typeof server.register !== 'function') {
    log(ctx, '[dsh-session-activity] webServer unavailable — client reports disabled')
    return
  }

  ctx.effect(() => server.register({
    kind: 'exact',
    path: ROUTE,
    handler: (req, res) => {
      const url = String(req.url === undefined ? '' : req.url)
      const cut = url.indexOf('?')
      const query = cut === -1 ? '' : url.slice(cut + 1)
      log(ctx, '[dsh-session-activity] client ' + (query === '' ? '(no query)' : query))
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end('ok')
    },
  }), 'dsh-session-activity: report route')
}
