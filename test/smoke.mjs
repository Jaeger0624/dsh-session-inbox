/**
 * Offline smoke test for the browser bundle.
 *
 * Runs the real `lib/client.js` against a stub React and stub runtime facts, so
 * the fold (which conversations appear, in what order, what a click does) is
 * verified without a browser. No dependency install: the React surface the
 * bundle uses is small enough to fake.
 */
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let captured = null
const styleCalls = []
const storage = new Map()
const documentStub = {
  getElementById: () => null,
  createElement: () => ({ id: '', textContent: '' }),
  head: { appendChild: (element) => styleCalls.push(element) },
}
const windowStub = {
  __ModuleLoader__: { load: (definition) => { captured = definition } },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
  },
  setInterval: () => 0,
  clearInterval: () => {},
}

class Component {
  constructor(props) { this.props = props }
  setState(patch) { this.state = Object.assign({}, this.state, patch) }
}
const React = {
  Component,
  createElement: (type, props, ...children) => ({
    type,
    props: Object.assign({}, props || {}, {
      children: children.length === 0 ? undefined : (children.length === 1 ? children[0] : children),
    }),
  }),
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  useMemo: (fn) => fn(),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
}

new Function('window', 'document', SRC)(windowStub, documentStub)
if (captured === null) throw new Error('bundle did not call __ModuleLoader__.load')

const plugin = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})

// ── runtime facts ─────────────────────────────────────────────────────────────
const now = Date.now()
const listSnapshot = {
  phase: 'ready',
  ids: ['s-run', 's-ask', 's-done', 's-idle', 's-old', 's-sub', 's-blank'],
  byId: {
    's-run': { id: 's-run', displayTitle: 'RUNNING-SESSION', running: true, blank: false, updatedAt: now - 60000, cwd: 'E:\\Vibe-Projects' },
    's-ask': { id: 's-ask', displayTitle: 'APPROVAL-SESSION', running: false, blank: false, updatedAt: now - 120000, cwd: 'E:\\deepseek-harness-learn' },
    's-done': {
      id: 's-done', displayTitle: 'DONE-UNSEEN-SESSION', running: false, blank: false, updatedAt: now - 3600000, cwd: 'E:\\GameLab',
      projectionValues: { sessionInbox: { turn: 3, time: now - 30000, reason: 'completed' } },
    },
    's-idle': {
      id: 's-idle', displayTitle: 'IDLE-SESSION', running: false, blank: false, updatedAt: now - 7200000, cwd: 'E:\\x',
      projectionValues: { sessionInbox: { turn: 1, time: now - 400000, reason: 'error' } },
    },
    's-old': {
      id: 's-old', displayTitle: 'OLD-FINISHED-SESSION', running: false, blank: false, updatedAt: now - 90000000, cwd: 'E:\\y',
      projectionValues: { sessionInbox: { turn: 2, time: now - 8000000, reason: 'completed' } },
    },
    's-sub': { id: 's-sub', displayTitle: 'SUBAGENT-SESSION', running: true, blank: false, origin: 'subagent', updatedAt: now, cwd: 'E:\\z' },
    's-blank': { id: 's-blank', displayTitle: 'BLANK-SESSION', running: false, blank: true, updatedAt: now, cwd: 'E:\\w' },
  },
}
const statusSnapshot = new Map([
  ['s-run', { running: true, pendingInteraction: undefined, completionUnread: false }],
  ['s-ask', { running: false, pendingInteraction: { key: 'k1', kind: 'approval', sessionId: 's-ask' }, completionUnread: false }],
  ['s-done', { running: false, pendingInteraction: undefined, completionUnread: true }],
  ['s-idle', { running: false, pendingInteraction: undefined, completionUnread: false }],
])
const store = (value) => ({ subscribe: () => () => {}, getSnapshot: () => value })

const opened = []
const panels = []
const registrations = []
const services = {
  sessions: { list: store(listSnapshot) },
  uiSession: { sessionStatus: store(statusSnapshot) },
  uiWorkspace: { openSession: (id) => opened.push(id) },
  layout: { selectPanel: (id) => panels.push(id) },
}
const ctx = {
  get: (name) => services[name],
  effect: (fn) => { fn(); return () => {} },
  locale: {
    register: () => () => {},
    bind: () => (key, params) => (params && 'n' in params ? key + '(' + params.n + ')' : key),
  },
  slots: {
    inject: (name, cb) => { cb(); return () => {} },
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
  },
}
globalThis.fetch = () => Promise.resolve({ ok: true })

plugin.apply(ctx)

// ── renderer ──────────────────────────────────────────────────────────────────
function expand(node) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map(expand)
  const { type, props } = node
  if (typeof type === 'function') {
    const instance = type.prototype && type.prototype.render ? new type(props) : null
    return expand(instance ? instance.render() : type(props))
  }
  return { type, props: Object.assign({}, props, { children: expand(props.children) }) }
}

function render(node) {
  node = expand(node)
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(render).join('')
  return render(node.props.children)
}

function collect(node, predicate) {
  const out = []
  ;(function walk(current) {
    if (!current || typeof current !== 'object') return
    if (Array.isArray(current)) { current.forEach(walk); return }
    if (predicate(current)) out.push(current)
    const kids = current.props && current.props.children
    ;(Array.isArray(kids) ? kids : (kids === undefined ? [] : [kids])).forEach(walk)
  })(node)
  return out
}

// ── assertions ────────────────────────────────────────────────────────────────
const [iconReg, panelReg, footerReg] = registrations
const iconTree = expand(iconReg.component({ size: 16, active: false, ...iconReg.options.inject() }))
const panelTree = expand(panelReg.component({ ...panelReg.options.inject() }))
const panelText = render(panelTree)
const rows = collect(panelTree, (node) => node.type === 'li')
const buttons = rows.map((li) => (Array.isArray(li.props.children) ? li.props.children[0] : li.props.children))
const labels = buttons.map((button) => String(button.props['aria-label']))
const select = collect(panelTree, (node) => node.type === 'select')[0]
const toggle = collect(panelTree, (node) => node.type === 'button' && node.props.className === 'inbox-toggle')[0]

// Sidebar foot strip: wide renders the colored counts, rail renders nothing.
const stripWide = expand(footerReg.component({ wide: true, ...footerReg.options.inject() }))
const stripRail = expand(footerReg.component({ wide: false, ...footerReg.options.inject() }))
const stripChips = collect(stripWide, (node) => node.type === 'button')
const stripKinds = stripChips.map((chip) => chip.props['data-kind'])
const stripNumbers = stripChips.map((chip) => render(chip.props.children))

// Column mode: the toggle persists, and each outcome gets its own column.
storage.set('dsh-session-inbox:recent-columns', '1')
const columnTree = expand(panelReg.component({ ...panelReg.options.inject() }))
const columnNodes = collect(columnTree, (node) => node.type === 'div' && node.props.className === 'inbox-column')
const columnBuckets = columnNodes.map((node) => node.props['data-bucket'])
const columnHeads = columnNodes.map((node) => render(node.props.children[0]))
const columnRows = columnNodes.map((node) => collect(node, (child) => child.type === 'li').length)
const columnEmpty = columnNodes.map((node) => render(node).includes('columns.empty'))
storage.delete('dsh-session-inbox:recent-columns')

buttons[0].props.onClick()
buttons[3].props.onClick()

const checks = [
  ['registers sidebar row, main panel, and footer strip', registrations.length === 3],
  ['sidebar row id matches the panel key', registrations[0].options.id === registrations[1].options.key],
  ['icon draws an attention dot', JSON.stringify(iconTree).includes('"cx":13')],
  ['three actionable rows', labels.filter((label) => /state\.(pending|running|done)/.test(label)).length === 3],
  ['pending outranks running', labels[0].indexOf('state.pending.approval') === 0],
  ['running outranks finished', labels[1].indexOf('state.running') === 0],
  ['finished-unopened last', labels[2].indexOf('state.done') === 0],
  ['recent section renders', panelText.includes('recent.title')],
  ['recent is newest first', labels[3].indexOf('reason.error') === 0 && labels[4].indexOf('reason.completed') === 0],
  ['recent skips actionable ids', !labels.slice(3).some((label) => label.includes('APPROVAL-SESSION') || label.includes('DONE-UNSEEN-SESSION'))],
  ['recent skips subagent and blank', !panelText.includes('SUBAGENT-SESSION') && !panelText.includes('BLANK-SESSION')],
  ['default recent limit is 5 of 5/10/20/50', select !== undefined && select.props.value === '5' && select.props.children.length === 4],
  ['column toggle starts off', toggle !== undefined && toggle.props['data-on'] === '0' && toggle.props['aria-pressed'] === 'false'],
  ['strip counts one session per state', JSON.stringify(stripKinds) === JSON.stringify(['done', 'pending', 'failed', 'running'])],
  ['strip numbers match the fixtures', JSON.stringify(stripNumbers) === JSON.stringify(['1', '1', '1', '1'])],
  ['strip hides in the rail', stripRail === null],
  ['columns mode renders three buckets in order', JSON.stringify(columnBuckets) === JSON.stringify(['done', 'stopped', 'failed'])],
  ['column heads carry a label and count', columnHeads.every((head) => typeof head === 'string' && head.length > 0)],
  ['done column holds the finished session', columnRows[0] === 1],
  ['stopped column is empty and says so', columnRows[1] === 0 && columnEmpty[1] === true],
  ['failed column holds the errored session', columnRows[2] === 1],
  ['clicking the attention row opens it', opened[0] === 's-ask'],
  ['clicking a recent row opens it', opened[1] === 's-idle'],
  ['opening returns to the conversation', panels[0] === null],
  ['status source resolved, no degraded banner', !panelText.includes('degraded.hint')],
  ['stylesheet injected once', styleCalls.length === 1],
]

let failed = 0
for (const [name, ok] of checks) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name)
  if (!ok) failed += 1
}
console.log(failed === 0 ? `\nALL ${checks.length} CHECKS PASS` : `\n${failed} FAILURE(S)`)
process.exitCode = failed === 0 ? 0 : 1
