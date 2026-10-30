/* dsh-session-inbox — browser half (hand-written bundle, no build step).
 *
 * One list of the conversations that need the user right now:
 *   - running                → rotating ring ("进行中")
 *   - pendingInteraction     → amber dot ("待审批" / "计划待审" / "待回答")
 *   - completionUnread       → green dot ("已完成", cleared the moment the
 *                              session becomes the main view, or runs again)
 *
 * Contract (client-modules): window.__ModuleLoader__.load({ id, factory }).
 *
 * Mount:
 *   - 'sidebar.panellist' — the sidebar's global panel icon row (the shell owns
 *     the button, label, tooltip, rail geometry and active highlight; this entry
 *     draws only the glyph and an attention dot).
 *   - 'main' keyed by the same id — the center-column page the shell renders
 *     while this panel is selected.
 *   Both go through ctx.slots.inject, so load order against the shell does not
 *   matter and a shell without these seats simply shows nothing.
 *
 * Data (all already computed by the client runtime — nothing is inferred here):
 *   ctx.get('sessions').list          → { ids, byId } SessionListState
 *   ctx.get('uiSession').sessionStatus → Map<SessionId, SessionStatus>
 *   Navigation: ctx.get('uiWorkspace').openSession(id) selects the session AND
 *   shows its Conversation; opening is what clears completionUnread.
 */
;(function () {
  if (typeof window === 'undefined' || !window.__ModuleLoader__) return
  window.__ModuleLoader__.load({
    id: 'dsh-session-inbox',
    factory: (require) => {
      const React = require('react')
      const h = React.createElement
      const { useSyncExternalStore, useMemo, useState, useEffect, useCallback, useRef } = React

      const PLUGIN_ID = 'dsh-session-inbox'
      const NS = PLUGIN_ID
      const PANEL_ID = 'session-inbox'
      const CSS_ID = PLUGIN_ID + '-style'
      /** Row order among the shell's global panel rows (schedule 10, mnemon 30). */
      const PANEL_ORDER = 40
      /** Keep the bottom-of-sidebar strip as well as the row numbers. */
      const FOOTER_STRIP = false
      /** Selectable sizes of the recent-completions section. */
      const LIMITS = [5, 10, 20, 50]
      /** Default size the user asked for; the choice persists per browser. */
      const DEFAULT_LIMIT = 5
      const LIMIT_STORAGE = PLUGIN_ID + ':recent-limit'
      /** Whether the recent feed splits into outcome columns instead of one timeline. */
      const COLUMNS_STORAGE = PLUGIN_ID + ':recent-columns'
      /** Outcome buckets for column mode. Unknown reasons fall into `stopped`. */
      const STOPPED_REASONS = ['aborted', 'interrupted', 'blocked', 'forked']
      const FAILED_REASONS = ['error', 'max-tokens']
      /** How often the relative timestamps re-render while the panel is open. */
      const CLOCK_MS = 30000

      /** Module-level service handles, filled by apply() and read by components. */
      const services = { ctx: null, list: null, status: null }

      // ── dictionaries ──────────────────────────────────────────────────────────
      const zh = {
        'panel.label': '会话收件箱',
        'panel.hint': '正在运行的、跑完还没看的、等你回复的会话',
        'count.one': '{n} 条',
        'count.other': '{n} 条',
        'state.pending.approval': '待审批',
        'state.pending.plan-review': '计划待审',
        'state.pending.question': '待回答',
        'state.pending.other': '待回复',
        'state.running': '进行中',
        'state.done': '已完成',
        'empty.title': '没有需要处理的会话',
        'empty.hint': '运行中的会话、跑完但还没打开的会话、等你回复的会话会出现在这里。',
        'degraded.hint': '这个界面拿不到会话状态服务，只显示了运行状态。',
        'crash.title': '会话收件箱渲染失败',
        'crash.hint': '组件报错了，详情在浏览器控制台（搜索 dsh-session-inbox）。重新加载页面可以重试。',
        'recent.title': '最近完成',
        'recent.limit': '{n} 个',
        'recent.limitAria': '最近完成显示几个',
        'recent.empty': '还没有完成的对话。',
        'stats.aria': '会话状态计数',
        'stats.done': '完成未查看',
        'stats.pending': '待回答',
        'stats.failed': '出错',
        'stats.running': '正在进行',
        'columns.toggle': '分列',
        'columns.toggleAria': '把最近完成按结果分成三列',
        'columns.empty': '暂无',
        'column.done': '已完成',
        'column.stopped': '已停止',
        'column.failed': '错误',
        'reason.completed': '已完成',
        'reason.error': '出错',
        'reason.aborted': '已中止',
        'reason.interrupted': '已中断',
        'reason.max-tokens': '达上限',
        'reason.blocked': '被阻塞',
        'reason.forked': '已分叉',
        'reason.other': '已结束',
        'untitled': '未命名会话',
        'list.aria': '需要关注的会话',
        'meta.workspace': '工作区',
        'time.now': '刚刚',
        'time.minutes': '{n} 分钟',
        'time.hours': '{n} 小时',
        'time.days': '{n} 天',
        'time.months': '{n} 个月',
        'time.years': '{n} 年',
        'time.ago': '{t}前',
      }
      const en = {
        'panel.label': 'Session inbox',
        'panel.hint': 'Running, waiting-on-you, and finished-but-unopened conversations',
        'count.one': '{n} item',
        'count.other': '{n} items',
        'state.pending.approval': 'Needs approval',
        'state.pending.plan-review': 'Plan review',
        'state.pending.question': 'Needs answer',
        'state.pending.other': 'Needs reply',
        'state.running': 'Running',
        'state.done': 'Finished',
        'empty.title': 'Nothing needs you right now',
        'empty.hint': 'Conversations that are running, finished but unopened, or waiting for your reply show up here.',
        'degraded.hint': 'The session status service is unavailable here, so only running states are shown.',
        'crash.title': 'The activity panel failed to render',
        'crash.hint': 'The component threw; the details are in the browser console (search dsh-session-inbox). Reload the page to retry.',
        'recent.title': 'Recently finished',
        'recent.limit': '{n}',
        'recent.limitAria': 'How many recently finished conversations to show',
        'recent.empty': 'Nothing has finished yet.',
        'stats.aria': 'Session state counts',
        'stats.done': 'Unseen',
        'stats.pending': 'Waiting',
        'stats.failed': 'Errored',
        'stats.running': 'Running',
        'columns.toggle': 'Columns',
        'columns.toggleAria': 'Split recently finished conversations into outcome columns',
        'columns.empty': 'None',
        'column.done': 'Finished',
        'column.stopped': 'Stopped',
        'column.failed': 'Errored',
        'reason.completed': 'Finished',
        'reason.error': 'Errored',
        'reason.aborted': 'Aborted',
        'reason.interrupted': 'Interrupted',
        'reason.max-tokens': 'Hit token limit',
        'reason.blocked': 'Blocked',
        'reason.forked': 'Forked',
        'reason.other': 'Ended',
        'untitled': 'Untitled session',
        'list.aria': 'Conversations needing attention',
        'meta.workspace': 'Workspace',
        'time.now': 'just now',
        'time.minutes': '{n} min',
        'time.hours': '{n} hr',
        'time.days': '{n} d',
        'time.months': '{n} mo',
        'time.years': '{n} yr',
        'time.ago': '{t} ago',
      }

      // ── styles ────────────────────────────────────────────────────────────────
      const CSS = [
        '.inbox-root{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;',
        'color:var(--dsw-alias-label-primary,#111827);font-family:var(--dsw-font-family,inherit)}',
        '.inbox-head{display:flex;align-items:baseline;gap:10px;padding:24px 24px 10px;flex:none}',
        '.inbox-title{font-size:18px;line-height:26px;font-weight:600;margin:0;flex:none}',
        '.inbox-hint{font-size:12px;line-height:17px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
        'color:var(--dsw-alias-label-secondary,#6b7280)}',
        '.inbox-count{margin-left:auto;flex:none;font-size:12px;line-height:18px;padding:1px 10px;border-radius:999px;',
        'color:var(--dsw-alias-label-secondary,#6b7280);background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05))}',
        '.inbox-scroll{overflow-y:auto;flex:1;min-height:0;padding:0 12px 32px}',
        '.inbox-list{display:flex;flex-direction:column;gap:2px;padding:0;margin:0;list-style:none}',
        '.inbox-section{display:flex;align-items:center;gap:8px;margin:18px 0 6px;padding:14px 4px 0;',
        'border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}',
        '.inbox-section-title{font-size:12px;line-height:17px;font-weight:600;letter-spacing:.02em;',
        'color:var(--dsw-alias-label-secondary,#6b7280)}',
        '.inbox-limit-wrap{position:relative;display:inline-flex;align-items:center;flex:none}',
        '.inbox-limit{appearance:none;-webkit-appearance:none;font:inherit;font-size:12px;line-height:18px;',
        'padding:2px 20px 2px 9px;border:0;border-radius:999px;cursor:pointer;',
        'background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05));color:var(--dsw-alias-label-secondary,#6b7280);',
        'transition:background-color .15s ease}',
        '.inbox-limit:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08))}',
        '.inbox-limit:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2563eb);outline-offset:1px}',
        '.inbox-limit-caret{position:absolute;right:7px;pointer-events:none;',
        'color:var(--dsw-alias-label-secondary,#6b7280)}',
        '.inbox-recent-empty{font-size:12px;line-height:17px;padding:2px 4px 6px;',
        'color:var(--dsw-alias-label-secondary,#6b7280)}',
        '.inbox-dot[data-reason="completed"]{background:var(--dsw-alias-state-success-primary,#059669)}',
        '.inbox-dot[data-reason="failed"]{background:var(--dsw-alias-state-error-primary,#dc2626)}',
        '.inbox-chip[data-state="failed"]{color:var(--dsw-alias-state-error-primary,#dc2626);',
        'background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 12%,transparent)}',
        '.inbox-row-muted .inbox-name{color:var(--dsw-alias-label-secondary,#6b7280)}',
        '.inbox-row{box-sizing:border-box;display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;',
        'border:0;border-radius:var(--dsw-radius-md,10px);background:transparent;color:inherit;font:inherit;',
        'text-align:left;cursor:pointer;transition:background-color .15s ease;',
        'animation:inbox-in .3s cubic-bezier(.22,1,.36,1) backwards;animation-delay:calc(var(--inbox-i,0) * 16ms)}',
        '.inbox-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.045))}',
        '.inbox-row:active{transform:scale(.995)}',
        '.inbox-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2563eb);outline-offset:-2px}',
        '.inbox-mark{width:16px;height:16px;flex:none;display:inline-flex;align-items:center;justify-content:center}',
        '.inbox-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-idle-primary,#9ca3af)}',
        '.inbox-dot[data-state="pending"]{background:var(--dsw-alias-state-warn-primary,#d97706);',
        'box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d97706) 16%,transparent);',
        'animation:inbox-breathe 2.2s ease-in-out infinite}',
        '.inbox-dot[data-state="done"]{background:var(--dsw-alias-state-success-primary,#059669)}',
        '.inbox-spin{width:13px;height:13px;border-radius:50%;box-sizing:border-box;',
        'border:2px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));',
        'border-top-color:var(--dsw-alias-brand-primary,#2563eb);animation:inbox-spin .9s linear infinite}',
        '.inbox-body{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}',
        '.inbox-name{font-size:14px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.inbox-meta{font-size:12px;line-height:17px;display:flex;align-items:center;gap:6px;overflow:hidden;',
        'white-space:nowrap;color:var(--dsw-alias-label-secondary,#6b7280)}',
        '.inbox-meta-ws{min-width:0;overflow:hidden;text-overflow:ellipsis}',
        '.inbox-sep{flex:none;opacity:.5}',
        '.inbox-chip{flex:none;font-size:12px;line-height:18px;padding:1px 9px;border-radius:999px;white-space:nowrap;',
        'color:var(--dsw-alias-label-secondary,#6b7280);background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05))}',
        '.inbox-chip[data-state="pending"]{color:var(--dsw-alias-state-warn-primary,#d97706);',
        'background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d97706) 12%,transparent)}',
        '.inbox-chip[data-state="done"]{color:var(--dsw-alias-state-success-primary,#059669);',
        'background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#059669) 12%,transparent)}',
        '.inbox-empty{min-height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;',
        'gap:6px;padding:40px 24px;text-align:center}',
        '.inbox-degraded{margin:0 24px 8px;padding:6px 10px;border-radius:var(--dsw-radius-md,10px);font-size:12px;',
        'line-height:17px;color:var(--dsw-alias-state-warn-primary,#d97706);',
        'background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d97706) 10%,transparent)}',
        '.inbox-empty-icon{opacity:.45;margin-bottom:4px;color:var(--dsw-alias-label-secondary,#6b7280)}',
        '.inbox-empty-title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary,#111827)}',
        '.inbox-empty-hint{font-size:12px;line-height:17px;max-width:340px;',
        'color:var(--dsw-alias-label-secondary,#6b7280)}',
        '.inbox-stats{display:flex;align-items:center;gap:2px;min-width:0;overflow:hidden}',
        '.inbox-stat{display:inline-flex;align-items:center;gap:3px;height:20px;padding:0 5px;border:0;border-radius:999px;',
        'background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font:inherit;font-size:12px;',
        'line-height:18px;cursor:pointer;white-space:nowrap}',
        '.inbox-stat:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.045))}',
        '.inbox-stat:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2563eb);outline-offset:0}',
        '.inbox-stat-dot{width:6px;height:6px;border-radius:50%;flex:none;',
        'background:var(--dsw-alias-state-idle-primary,#9ca3af)}',
        '.inbox-stat-num{font-variant-numeric:tabular-nums;font-weight:600}',
        '.inbox-stat[data-kind="done"] .inbox-stat-dot{background:var(--dsw-alias-state-success-primary,#059669)}',
        '.inbox-stat[data-kind="done"] .inbox-stat-num{color:var(--dsw-alias-state-success-primary,#059669)}',
        '.inbox-stat[data-kind="pending"] .inbox-stat-dot{background:var(--dsw-alias-state-warn-primary,#d97706)}',
        '.inbox-stat[data-kind="pending"] .inbox-stat-num{color:var(--dsw-alias-state-warn-primary,#d97706)}',
        '.inbox-stat[data-kind="failed"] .inbox-stat-dot{background:var(--dsw-alias-state-error-primary,#dc2626)}',
        '.inbox-stat[data-kind="failed"] .inbox-stat-num{color:var(--dsw-alias-state-error-primary,#dc2626)}',
        '.inbox-stat[data-kind="running"] .inbox-stat-dot{background:var(--dsw-alias-brand-primary,#2563eb)}',
        '.inbox-stat[data-kind="running"] .inbox-stat-num{color:var(--dsw-alias-brand-primary,#2563eb)}',
        '.inbox-anchor{display:inline-flex;align-items:center;justify-content:center}',
        '.inbox-row-stats{position:fixed;z-index:5;display:inline-flex;align-items:center;gap:7px;',
        'transform:translateY(-50%);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;',
        'pointer-events:none;color:var(--dsw-alias-label-secondary,#6b7280)}',
        '.inbox-row-stat{display:inline-flex;align-items:center;gap:3px}',
        '.inbox-row-stat .inbox-stat-dot{width:5px;height:5px;background:currentColor}',
        '.inbox-row-stat[data-kind="done"]{color:var(--dsw-alias-state-success-primary,#059669)}',
        '.inbox-row-stat[data-kind="pending"]{color:var(--dsw-alias-state-warn-primary,#d97706)}',
        '.inbox-row-stat[data-kind="failed"]{color:var(--dsw-alias-state-error-primary,#dc2626)}',
        '.inbox-row-stat[data-kind="running"]{color:var(--dsw-alias-brand-primary,#2563eb)}',
        '.inbox-section-actions{margin-left:auto;display:flex;align-items:center;gap:6px}',
        '.inbox-toggle{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:12px;line-height:18px;',
        'padding:2px 9px;border:0;border-radius:999px;cursor:pointer;',
        'background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05));color:var(--dsw-alias-label-secondary,#6b7280);',
        'transition:background-color .15s ease,color .15s ease}',
        '.inbox-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08))}',
        '.inbox-toggle[data-on="1"]{color:var(--dsw-alias-brand-primary,#2563eb);',
        'background:color-mix(in srgb,var(--dsw-alias-brand-primary,#2563eb) 12%,transparent)}',
        '.inbox-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2563eb);outline-offset:1px}',
        '.inbox-toggle-icon{flex:none;opacity:.85}',
        '.inbox-columns{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}',
        '.inbox-column{min-width:0;display:flex;flex-direction:column;gap:2px}',
        '.inbox-column-head{display:flex;align-items:center;gap:6px;padding:2px 4px 6px;font-size:12px;line-height:17px;',
        'font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280)}',
        '.inbox-column-head .inbox-stat-dot{width:7px;height:7px}',
        '.inbox-column[data-bucket="done"] .inbox-stat-dot{background:var(--dsw-alias-state-success-primary,#059669)}',
        '.inbox-column[data-bucket="stopped"] .inbox-stat-dot{background:var(--dsw-alias-label-secondary,#6b7280)}',
        '.inbox-column[data-bucket="failed"] .inbox-stat-dot{background:var(--dsw-alias-state-error-primary,#dc2626)}',
        '.inbox-column-count{margin-left:auto;font-weight:400;opacity:.7;font-variant-numeric:tabular-nums}',
        '.inbox-column-empty{font-size:12px;line-height:17px;padding:2px 4px;',
        'color:var(--dsw-alias-label-secondary,#6b7280);opacity:.7}',
        '@keyframes inbox-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
        '@keyframes inbox-spin{to{transform:rotate(360deg)}}',
        '@keyframes inbox-breathe{0%,100%{box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d97706) 14%,transparent)}',
        '50%{box-shadow:0 0 0 5px color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d97706) 6%,transparent)}}',
        '@media (prefers-reduced-motion: reduce){.inbox-row{animation:none}.inbox-dot[data-state="pending"]{animation:none}',
        '.inbox-spin{animation-duration:3s}.inbox-row:active{transform:none}}',
      ].join('')

      /** Inject the stylesheet once; a second call is a no-op. */
      function ensureCss() {
        if (typeof document === 'undefined') return
        if (document.getElementById(CSS_ID)) return
        const style = document.createElement('style')
        style.id = CSS_ID
        style.textContent = CSS
        document.head.appendChild(style)
      }

      // ── service + observable adapters ─────────────────────────────────────────
      /**
       * Read one client service by key, falling back to the context property.
       * @param ctx client root context.
       * @param name service key.
       * @returns the service, or undefined when this composition lacks it.
       */
      function serviceOf(ctx, name) {
        try {
          const viaGet = typeof ctx.get === 'function' ? ctx.get(name) : undefined
          if (viaGet !== undefined && viaGet !== null) return viaGet
        } catch (err) {
          /* fall through to the property probe */
        }
        try {
          return ctx[name] === undefined ? undefined : ctx[name]
        } catch (err) {
          return undefined
        }
      }

      /**
       * Adapt a bare observable to the store shape React can subscribe to.
       * @param source object exposing getSnapshot()/subscribe().
       * @returns { subscribe, getSnapshot }, or null when the shape is absent.
       */
      function asStore(source) {
        if (!source || typeof source.subscribe !== 'function' || typeof source.getSnapshot !== 'function') return null
        return {
          subscribe: (listener) => source.subscribe(listener),
          getSnapshot: () => source.getSnapshot(),
        }
      }

      const EMPTY_LIST = { ids: [], byId: {} }
      const EMPTY_STATUS = new Map()

      /** Subscribe one component to one store. */
      function useStore(store, empty) {
        const subscribe = useCallback((listener) => (store ? store.subscribe(listener) : () => {}), [store])
        const read = useCallback(() => {
          if (!store) return empty
          const value = store.getSnapshot()
          return value === undefined || value === null ? empty : value
        }, [store, empty])
        return useSyncExternalStore(subscribe, read, read)
      }

      // ── derivation ────────────────────────────────────────────────────────────
      /** Presentation order: something waiting on the user outranks mere movement. */
      const RANK = { pending: 0, running: 1, done: 2 }
      const KNOWN_PENDING = ['approval', 'plan-review', 'question']
      /** Column order in the split recent view. */
      const COLUMN_ORDER = ['done', 'stopped', 'failed']

      /**
       * Reduce one status row to the single state the list shows, mirroring the
       * runtime's own precedence: a pending interaction outranks live activity.
       */
      function pendingKindOf(status) {
        const interaction = status === undefined || status === null ? undefined : status.pendingInteraction
        if (interaction === undefined || interaction === null) return null
        const kind = typeof interaction.kind === 'string' ? interaction.kind : ''
        if (kind === '') return null
        return KNOWN_PENDING.indexOf(kind) === -1 ? 'other' : kind
      }

      /** Last non-empty path segment, the label the host uses for a workspace. */
      function workspaceOf(cwd) {
        if (typeof cwd !== 'string' || cwd === '') return ''
        const parts = cwd.split(/[\\/]+/).filter((part) => part !== '')
        return parts.length === 0 ? '' : parts[parts.length - 1]
      }

      /**
       * Build the list rows from the two runtime facts.
       * @param list SessionListState snapshot.
       * @param statuses SessionStatus map.
       * @param t bound translate.
       * @returns actionable rows, most urgent first then most recent first.
       */
      function deriveRows(list, statuses, t) {
        const rows = []
        const ids = list && Array.isArray(list.ids) ? list.ids : []
        const byId = list && list.byId ? list.byId : {}
        for (const id of ids) {
          const row = byId[id]
          if (!row) continue
          if (row.origin === 'subagent') continue
          if (row.blank === true) continue
          const status = statuses ? statuses.get(id) : undefined
          const running = status && status.running !== undefined ? status.running === true : row.running === true
          const kind = pendingKindOf(status)
          const done = status ? status.completionUnread === true : false
          const state = kind !== null ? 'pending' : running ? 'running' : done ? 'done' : null
          if (state === null) continue
          rows.push({
            id,
            title: row.displayTitle || row.title || t('untitled'),
            workspace: workspaceOf(row.cwd),
            updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
            state,
            kind,
          })
        }
        rows.sort((a, b) => (RANK[a.state] - RANK[b.state]) || (b.updatedAt - a.updatedAt))
        return rows
      }

      /** Outcome bucket of one completion reason; unknown reasons read as stopped. */
      function bucketOf(reason) {
        if (reason === 'completed') return 'done'
        if (FAILED_REASONS.indexOf(reason) !== -1) return 'failed'
        return 'stopped'
      }

      /**
       * Recently finished conversations, newest first.
       *
       * Completion time and reason come from the host `sessionInbox`
       * projection (`turn/end` folded per session), so a completion survives a
       * page reload. Ids already listed as actionable are skipped: a turn that
       * finished while you were away belongs to the attention list, not both.
       * @returns every recent completion; the caller decides how many to show.
       */
      function deriveRecent(list, taken, t) {
        const out = []
        const ids = list && Array.isArray(list.ids) ? list.ids : []
        const byId = list && list.byId ? list.byId : {}
        for (const id of ids) {
          if (taken.has(id)) continue
          const row = byId[id]
          if (!row) continue
          if (row.origin === 'subagent') continue
          if (row.blank === true) continue
          const value = row.projectionValues === undefined || row.projectionValues === null
            ? undefined
            : row.projectionValues.sessionInbox
          if (value === undefined || value === null) continue
          if (!(typeof value.time === 'number' && value.time > 0)) continue
          if (!(typeof value.turn === 'number' && value.turn > 0)) continue
          out.push({
            id,
            title: row.displayTitle || row.title || t('untitled'),
            workspace: workspaceOf(row.cwd),
            time: value.time,
            reason: typeof value.reason === 'string' ? value.reason : '',
          })
        }
        out.sort((a, b) => b.time - a.time)
        return out
      }

      /**
       * The four counts the sidebar strip shows, as a partition: every visible
       * session lands in exactly one bucket. Precedence is "what needs you most":
       * waiting on you, then running, then a failed last turn, then a finished
       * turn you have not opened yet.
       * @param list SessionListState snapshot.
       * @param statuses SessionStatus map.
       */
      function deriveStats(list, statuses) {
        const stats = { pending: 0, running: 0, failed: 0, done: 0 }
        const ids = list && Array.isArray(list.ids) ? list.ids : []
        const byId = list && list.byId ? list.byId : {}
        for (const id of ids) {
          const row = byId[id]
          if (!row) continue
          if (row.origin === 'subagent') continue
          if (row.blank === true) continue
          const status = statuses ? statuses.get(id) : undefined
          if (pendingKindOf(status) !== null) {
            stats.pending += 1
            continue
          }
          const running = status && status.running !== undefined ? status.running === true : row.running === true
          if (running) {
            stats.running += 1
            continue
          }
          const value = row.projectionValues === undefined || row.projectionValues === null
            ? undefined
            : row.projectionValues.sessionInbox
          const finished = value !== undefined && value !== null && typeof value.time === 'number' && value.time > 0
          const reason = finished && typeof value.reason === 'string' ? value.reason : ''
          if (finished && bucketOf(reason) === 'failed') {
            stats.failed += 1
            continue
          }
          if (status ? status.completionUnread === true : false) stats.done += 1
        }
        return stats
      }

      /** Read the persisted recent-list size (5 unless the user chose another). */
      function readLimit() {
        try {
          const raw = window.localStorage.getItem(LIMIT_STORAGE)
          const value = Number(raw)
          return LIMITS.indexOf(value) === -1 ? DEFAULT_LIMIT : value
        } catch (err) {
          return DEFAULT_LIMIT
        }
      }

      /** Persist the recent-list size; a blocked storage keeps the in-memory value. */
      function writeLimit(value) {
        try {
          window.localStorage.setItem(LIMIT_STORAGE, String(value))
        } catch (err) {
          /* private mode or a full quota: the picker still works for this session */
        }
      }

      /** Whether the recent feed is shown as outcome columns. */
      function readColumns() {
        try {
          return window.localStorage.getItem(COLUMNS_STORAGE) === '1'
        } catch (err) {
          return false
        }
      }

      /** Persist the column toggle; a blocked storage keeps the in-memory value. */
      function writeColumns(value) {
        try {
          window.localStorage.setItem(COLUMNS_STORAGE, value === true ? '1' : '0')
        } catch (err) {
          /* private mode or a full quota: the toggle still works for this session */
        }
      }

      /**
       * Rows, counts, and the recent feed for the panel and the sidebar glyph.
       *
       * Both observables come from the client services read in `apply`, so the
       * hook count never depends on props: a slot frame that supplies its own
       * selector hooks is ignored on purpose, because switching sources between
       * renders would change the hook order.
       * @param t bound translate.
       * @param limit rows per recent list (0 renders no recent feed).
       * @param columns true groups the recent feed into outcome columns.
       */
      function useActivity(t, limit, columns) {
        const list = useStore(services.list, EMPTY_LIST)
        const statuses = useStore(services.status, EMPTY_STATUS)
        const statusSource = services.status !== null
        return useMemo(() => {
          const rows = deriveRows(list, statuses, t)
          const stats = deriveStats(list, statuses)
          const taken = new Set()
          for (const row of rows) taken.add(row.id)
          const all = deriveRecent(list, taken, t)
          const size = limit === undefined ? 0 : limit
          let recent = []
          let recentColumns = null
          if (size > 0) {
            if (columns === true) {
              recentColumns = COLUMN_ORDER.map((bucket) => {
                const bucketRows = all.filter((row) => bucketOf(row.reason) === bucket)
                return { bucket, rows: bucketRows.length <= size ? bucketRows : bucketRows.slice(0, size) }
              })
            } else {
              recent = all.length <= size ? all : all.slice(0, size)
            }
          }
          return {
            rows,
            pending: stats.pending,
            running: stats.running,
            failed: stats.failed,
            done: stats.done,
            statusSource,
            recent,
            recentColumns,
          }
        }, [list, statuses, t, statusSource, limit, columns])
      }

      // ── text helpers ──────────────────────────────────────────────────────────
      /** Relative time in the host's own wording. */
      function relTime(ts, now, t) {
        if (typeof ts !== 'number' || ts <= 0 || !isFinite(ts)) return ''
        const diff = Math.max(0, now - ts)
        const minutes = Math.floor(diff / 60000)
        if (minutes < 1) return t('time.now')
        if (minutes < 60) return t('time.ago', { t: t('time.minutes', { n: minutes }) })
        const hours = Math.floor(minutes / 60)
        if (hours < 24) return t('time.ago', { t: t('time.hours', { n: hours }) })
        const days = Math.floor(hours / 24)
        if (days < 30) return t('time.ago', { t: t('time.days', { n: days }) })
        const months = Math.floor(days / 30)
        if (months < 12) return t('time.ago', { t: t('time.months', { n: months }) })
        return t('time.ago', { t: t('time.years', { n: Math.floor(months / 12) }) })
      }

      /** Absolute timestamp for the row tooltip. */
      function absTime(ts) {
        if (typeof ts !== 'number' || ts <= 0) return ''
        try {
          return new Date(ts).toLocaleString()
        } catch (err) {
          return ''
        }
      }

      /** Count text in the singular/plural key the dictionaries declare. */
      function countText(n, t) {
        return n === 1 ? t('count.one', { n }) : t('count.other', { n })
      }

      /** A ticking clock so relative timestamps stay honest while the panel is open. */
      function useNow() {
        const [now, setNow] = useState(() => Date.now())
        useEffect(() => {
          const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS)
          return () => window.clearInterval(timer)
        }, [])
        return now
      }

      // ── components ────────────────────────────────────────────────────────────
      /** The one status mark per row: amber dot, rotating ring, or green dot. */
      function StatusMark({ row }) {
        if (row.state === 'running') {
          return h('span', { className: 'inbox-mark', 'aria-hidden': true }, h('span', { className: 'inbox-spin' }))
        }
        return h('span', { className: 'inbox-mark', 'aria-hidden': true },
          h('span', { className: 'inbox-dot', 'data-state': row.state }))
      }

      /** Chip label for one row. */
      function stateLabel(row, t) {
        if (row.state === 'pending') return t('state.pending.' + (row.kind || 'other'))
        return t(row.state === 'running' ? 'state.running' : 'state.done')
      }

      /** Attention dot painted into the sidebar glyph, in the same status colors. */
      function badgeState(counts) {
        if (counts.pending > 0) return 'pending'
        if (counts.failed > 0) return 'failed'
        if (counts.done > 0) return 'done'
        if (counts.running > 0) return 'running'
        return null
      }
      const BADGE_FILL = {
        pending: 'var(--dsw-alias-state-warn-primary,#d97706)',
        failed: 'var(--dsw-alias-state-error-primary,#dc2626)',
        done: 'var(--dsw-alias-state-success-primary,#059669)',
        running: 'var(--dsw-alias-brand-primary,#2563eb)',
      }

      /** Nothing a slot occupant can do may blank the shell's own row or page. */
      class SafeBoundary extends React.Component {
        constructor(props) {
          super(props)
          this.state = { failed: false }
        }

        static getDerivedStateFromError() {
          return { failed: true }
        }

        componentDidCatch(error) {
          console.warn('[dsh-session-inbox] slot entry crashed:', error)
        }

        render() {
          return this.state.failed === true ? this.props.fallback : this.props.children
        }
      }

      /** The bare glyph, used when the data-aware icon cannot render. */
      function StaticIcon(props) {
        const size = typeof props.size === 'number' ? props.size : 16
        return h('svg', {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'data-dsh-panel-entry': PANEL_ID,
          'aria-hidden': true,
        }, h('path', { d: 'M2 8h2.1l1.4-3.2 2.2 6.4 1.5-3.2H14' }))
      }

      /**
       * The sidebar row glyph. The shell owns the button, the label, the tooltip
       * and the rail geometry; this draws the pulse mark plus an attention dot.
       */
      function PanelIcon(props) {
        return h(SafeBoundary, { fallback: h(StaticIcon, { size: props.size }) }, h(PanelIconLive, props))
      }

      /**
       * Measure the shell's sidebar row that hosts our glyph.
       *
       * The shell owns that row (`button.panelRow > [glyph][title]`) and hands the
       * plugin only the glyph cell, so trailing content cannot flow there. This
       * reads the row's box and keeps a pointer-transparent overlay glued to its
       * right edge while the column resizes or the window scrolls.
       * @param ref ref on our own wrapper inside the glyph cell.
       * @returns the row box, or null before the first measurement.
       */
      function useRowBox(ref) {
        const [box, setBox] = useState(null)
        useEffect(() => {
          const node = ref.current
          if (node === null || node === undefined || typeof node.closest !== 'function') return
          const row = node.closest('button')
          if (row === null) return
          let frame = 0
          const measure = () => {
            frame = 0
            const rect = row.getBoundingClientRect()
            setBox((prev) => {
              if (prev !== null
                && Math.abs(prev.right - rect.right) < 0.5
                && Math.abs(prev.top - rect.top) < 0.5
                && Math.abs(prev.width - rect.width) < 0.5) return prev
              return { right: rect.right, top: rect.top, height: rect.height, width: rect.width }
            })
          }
          const schedule = () => {
            if (frame !== 0) return
            frame = window.requestAnimationFrame(measure)
          }
          measure()
          const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(schedule) : null
          if (observer !== null) observer.observe(row)
          window.addEventListener('scroll', schedule, true)
          window.addEventListener('resize', schedule)
          return () => {
            if (frame !== 0) window.cancelAnimationFrame(frame)
            if (observer !== null) observer.disconnect()
            window.removeEventListener('scroll', schedule, true)
            window.removeEventListener('resize', schedule)
          }
        }, [ref])
        return box
      }

      /** Glyph + attention dot, the data-aware half behind the boundary. */
      function PanelIconLive(props) {
        const t = props.t
        const size = typeof props.size === 'number' ? props.size : 16
        const counts = useActivity(t)
        const badge = badgeState(counts)
        const anchor = useRef(null)
        const box = useRowBox(anchor)
        const children = [
          h('path', { key: 'pulse', d: 'M2 8h2.1l1.4-3.2 2.2 6.4 1.5-3.2H14' }),
        ]
        if (badge !== null) {
          children.push(h('circle', {
            key: 'badge',
            cx: 13,
            cy: 3,
            r: 2.1,
            fill: BADGE_FILL[badge],
            stroke: 'none',
          }))
        }
        const glyph = h('svg', {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'data-dsh-panel-entry': PANEL_ID,
          'aria-hidden': true,
        }, children)
        const stats = box === null || box.width < 140 ? null : rowStats(box, counts, t)
        return h('span', { ref: anchor, className: 'inbox-anchor' }, glyph, stats)
      }

      /**
       * The four counts pinned to the row's right edge.
       * @param box measured row box.
       * @param counts per-state counts.
       * @param t bound translate.
       */
      function rowStats(box, counts, t) {
        const viewport = typeof window === 'undefined' ? 0 : window.innerWidth
        const items = ['done', 'pending', 'failed', 'running']
          .map((kind) => ({ kind, n: counts[kind] }))
          .filter((item) => item.n > 0)
        if (items.length === 0) return null
        return h('span', {
          className: 'inbox-row-stats',
          style: {
            right: Math.max(6, viewport - box.right + 10) + 'px',
            top: (box.top + box.height / 2) + 'px',
          },
          'aria-hidden': true,
        }, items.map((item) => h('span', {
          key: item.kind,
          className: 'inbox-row-stat',
          'data-kind': item.kind,
          title: t('stats.' + item.kind) + ' ' + item.n,
        },
          h('span', { className: 'inbox-stat-dot' }),
          h('span', { className: 'inbox-stat-num' }, String(item.n)),
        )))
      }

      /** One conversation row. */
      function Row({ row, index, now, t, onOpen }) {
        const meta = []
        if (row.workspace !== '') {
          meta.push(h('span', { key: 'ws', className: 'inbox-meta-ws' }, row.workspace))
          meta.push(h('span', { key: 's1', className: 'inbox-sep', 'aria-hidden': true }, '·'))
        }
        meta.push(h('span', { key: 'time' }, relTime(row.updatedAt, now, t)))
        const label = stateLabel(row, t)
        return h('li', { className: 'inbox-item', style: { '--inbox-i': Math.min(index, 8) } },
          h('button', {
            type: 'button',
            className: 'inbox-row',
            title: [label, row.workspace, absTime(row.updatedAt)].filter((part) => part !== '').join(' · '),
            'aria-label': [label, row.title, relTime(row.updatedAt, now, t)].filter((part) => part !== '').join('，'),
            onClick: () => onOpen(row.id),
          },
            h(StatusMark, { row }),
            h('span', { className: 'inbox-body' },
              h('span', { className: 'inbox-name' }, row.title),
              h('span', { className: 'inbox-meta' }, meta),
            ),
            h('span', { className: 'inbox-chip', 'data-state': row.state }, label),
          ))
      }

      /**
       * One recently finished conversation: time-ordered, muted, reason-tagged.
       * @param compact true inside a column, where the column head already names
       *   the outcome and the chip would only squeeze the title.
       */
      function RecentRow({ row, index, now, t, onOpen, compact }) {
        const bucket = bucketOf(row.reason)
        const dotReason = bucket === 'done' ? 'completed' : bucket === 'failed' ? 'failed' : 'stopped'
        const label = t('reason.' + (row.reason === '' ? 'other' : row.reason))
        const meta = []
        if (row.workspace !== '') {
          meta.push(h('span', { key: 'ws', className: 'inbox-meta-ws' }, row.workspace))
          meta.push(h('span', { key: 's1', className: 'inbox-sep', 'aria-hidden': true }, '·'))
        }
        meta.push(h('span', { key: 'time' }, relTime(row.time, now, t)))
        return h('li', { className: 'inbox-item inbox-row-muted', style: { '--inbox-i': Math.min(index, 8) } },
          h('button', {
            type: 'button',
            className: 'inbox-row',
            title: [label, row.workspace, absTime(row.time)].filter((part) => part !== '').join(' · '),
            'aria-label': [label, row.title, relTime(row.time, now, t)].filter((part) => part !== '').join('，'),
            onClick: () => onOpen(row.id),
          },
            h('span', { className: 'inbox-mark', 'aria-hidden': true },
              h('span', {
                className: 'inbox-dot',
                'data-state': 'recent',
                'data-reason': dotReason,
              })),
            h('span', { className: 'inbox-body' },
              h('span', { className: 'inbox-name' }, row.title),
              h('span', { className: 'inbox-meta' }, meta),
            ),
            compact === true ? null : h('span', { className: 'inbox-chip', 'data-state': bucket }, label),
          ))
      }

      /** One outcome column of the split recent view. */
      function RecentColumn({ column, now, t, onOpen }) {
        return h('div', { className: 'inbox-column', 'data-bucket': column.bucket },
          h('div', { className: 'inbox-column-head' },
            h('span', { className: 'inbox-stat-dot', 'aria-hidden': true }),
            h('span', null, t('column.' + column.bucket)),
            h('span', { className: 'inbox-column-count' }, String(column.rows.length)),
          ),
          column.rows.length === 0
            ? h('div', { className: 'inbox-column-empty' }, t('columns.empty'))
            : h('ul', { className: 'inbox-list', 'aria-label': t('column.' + column.bucket) },
                column.rows.map((row, index) => h(RecentRow, {
                  key: row.id,
                  row,
                  index,
                  now,
                  t,
                  onOpen,
                  compact: true,
                })),
              ),
        )
      }

      /**
       * Colored per-state counts in the sidebar foot, beside Settings. The shell
       * owns the row; this renders a compact dot+number per non-empty state and
       * opens the panel when clicked.
       */
      function SidebarStats(props) {
        return h(SafeBoundary, { fallback: null }, h(SidebarStatsLive, props))
      }

      /** Data-aware half of the footer strip. */
      function SidebarStatsLive(props) {
        const t = props.t
        const counts = useActivity(t)
        if (props.wide === false) return null
        const items = ['done', 'pending', 'failed', 'running']
          .map((kind) => ({ kind, n: counts[kind] }))
          .filter((item) => item.n > 0)
        if (items.length === 0) return null
        return h('div', { className: 'inbox-stats', role: 'group', 'aria-label': t('stats.aria') },
          items.map((item) => h('button', {
            key: item.kind,
            type: 'button',
            className: 'inbox-stat',
            'data-kind': item.kind,
            title: t('stats.' + item.kind) + ' · ' + t('panel.label'),
            'aria-label': t('stats.' + item.kind) + ' ' + item.n,
            onClick: () => props.openPanel(),
          },
            h('span', { className: 'inbox-stat-dot', 'aria-hidden': true }),
            h('span', { className: 'inbox-stat-num' }, String(item.n)),
          )))
      }

      /** What renders when the panel's own logic failed: a plain, honest notice. */
      function PanelFailed(props) {
        const t = typeof props.t === 'function' ? props.t : (key) => key
        return h('div', { className: 'inbox-root', 'data-dsh-session-inbox': '', 'data-failed': '' },
          h('div', { className: 'inbox-empty' },
            h('div', { className: 'inbox-empty-title' }, t('crash.title')),
            h('div', { className: 'inbox-empty-hint' }, t('crash.hint')),
          ))
      }

      /** The center-column page the shell renders while this panel is selected. */
      function ActivityPanel(props) {
        return h(SafeBoundary, { fallback: h(PanelFailed, { t: props.t }) }, h(ActivityPanelBody, props))
      }

      /** Page body behind the boundary. */
      function ActivityPanelBody(props) {
        const t = props.t
        const openSession = props.openSession
        const [limit, setLimit] = useState(readLimit)
        const [columns, setColumns] = useState(readColumns)
        const counts = useActivity(t, limit, columns)
        const now = useNow()
        const rows = counts.rows
        const head = h('div', { className: 'inbox-head' },
          h('h1', { className: 'inbox-title' }, t('panel.label')),
          h('span', { className: 'inbox-hint' }, t('panel.hint')),
          rows.length > 0 ? h('span', { className: 'inbox-count' }, countText(rows.length, t)) : null,
        )
        const degraded = counts.statusSource !== true
          ? h('div', { className: 'inbox-degraded' }, t('degraded.hint'))
          : null
        const body = rows.length === 0
          ? h('div', { className: 'inbox-empty' },
              h('svg', {
                className: 'inbox-empty-icon',
                width: 32,
                height: 32,
                viewBox: '0 0 16 16',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.2,
                strokeLinecap: 'round',
                'aria-hidden': true,
              }, h('path', { d: 'M2 8h2.1l1.4-3.2 2.2 6.4 1.5-3.2H14' })),
              h('div', { className: 'inbox-empty-title' }, t('empty.title')),
              h('div', { className: 'inbox-empty-hint' }, t('empty.hint')),
            )
          : h('ul', { className: 'inbox-list', 'aria-label': t('list.aria') },
              rows.map((row, index) => h(Row, {
                key: row.id,
                row,
                index,
                now,
                t,
                onOpen: openSession,
              })),
            )
        const picker = h('span', { className: 'inbox-limit-wrap' },
          h('select', {
            className: 'inbox-limit',
            value: String(limit),
            'aria-label': t('recent.limitAria'),
            onChange: (event) => {
              const next = Number(event.target.value)
              if (LIMITS.indexOf(next) === -1) return
              writeLimit(next)
              setLimit(next)
            },
          }, LIMITS.map((option) => h('option', { key: option, value: String(option) },
            t('recent.limit', { n: option })))),
          h('svg', {
            className: 'inbox-limit-caret',
            width: 10,
            height: 10,
            viewBox: '0 0 10 10',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
          }, h('path', { d: 'M2.5 4l2.5 2.5L7.5 4' })),
        )
        const toggle = h('button', {
          type: 'button',
          className: 'inbox-toggle',
          'data-on': columns === true ? '1' : '0',
          'aria-pressed': columns === true ? 'true' : 'false',
          'aria-label': t('columns.toggleAria'),
          title: t('columns.toggleAria'),
          onClick: () => {
            const next = columns !== true
            writeColumns(next)
            setColumns(next)
          },
        },
          h('svg', {
            className: 'inbox-toggle-icon',
            width: 12,
            height: 12,
            viewBox: '0 0 12 12',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinejoin: 'round',
            'aria-hidden': true,
          },
            h('rect', { x: 1.5, y: 2, width: 9, height: 8, rx: 1.6 }),
            h('path', { d: 'M5 2v8M8 2v8' }),
          ),
          h('span', null, t('columns.toggle')),
        )
        const recentColumns = counts.recentColumns
        const columnsEmpty = recentColumns !== null
          && recentColumns.every((column) => column.rows.length === 0)
        let recentBody
        if (recentColumns === null) {
          recentBody = counts.recent.length === 0
            ? h('div', { className: 'inbox-recent-empty' }, t('recent.empty'))
            : h('ul', { className: 'inbox-list', 'aria-label': t('recent.title') },
                counts.recent.map((row, index) => h(RecentRow, {
                  key: row.id,
                  row,
                  index,
                  now,
                  t,
                  onOpen: openSession,
                })),
              )
        } else if (columnsEmpty) {
          recentBody = h('div', { className: 'inbox-recent-empty' }, t('recent.empty'))
        } else {
          recentBody = h('div', { className: 'inbox-columns' },
            recentColumns.map((column) => h(RecentColumn, {
              key: column.bucket,
              column,
              now,
              t,
              onOpen: openSession,
            })),
          )
        }
        const recent = h('div', { className: 'inbox-recent' },
          h('div', { className: 'inbox-section' },
            h('span', { className: 'inbox-section-title' }, t('recent.title')),
            h('div', { className: 'inbox-section-actions' }, toggle, picker),
          ),
          recentBody,
        )
        return h('div', { className: 'inbox-root', 'data-dsh-session-inbox': '' }, head, degraded,
          h('div', { className: 'inbox-scroll' }, body, recent))
      }

      // ── plugin ────────────────────────────────────────────────────────────────
      const name = PLUGIN_ID
      const inject = ['slots', 'sessions', 'uiSession', 'uiWorkspace', 'layout', 'locale']

      function apply(ctx) {
        ensureCss()
        services.ctx = ctx

        try {
          ctx.effect(() => ctx.locale.register(NS, { zh, en }), PLUGIN_ID + ': dictionaries')
        } catch (err) {
          console.warn('[dsh-session-inbox] locale registration failed:', err)
        }
        let t = (key) => key
        try {
          t = ctx.locale.bind(NS)
        } catch (err) {
          console.warn('[dsh-session-inbox] locale unavailable, using keys:', err)
        }

        const sessionsService = serviceOf(ctx, 'sessions')
        services.list = asStore(sessionsService && sessionsService.list)
        if (services.list === null) {
          console.warn('[dsh-session-inbox] session list service unavailable — the panel stays empty')
        }
        const sessionStatusService = serviceOf(ctx, 'uiSession')
        services.status = asStore(sessionStatusService && sessionStatusService.sessionStatus)
        if (services.status === null) {
          console.warn('[dsh-session-inbox] session status service unavailable — only running states can show')
        }

        /** Select the conversation AND leave this panel, as one navigation. */
        const openSession = (sessionId) => {
          try {
            const nav = serviceOf(ctx, 'uiWorkspace')
            if (nav && typeof nav.openSession === 'function') nav.openSession(sessionId)
            else console.warn('[dsh-session-inbox] no navigation service — cannot open', sessionId)
          } catch (err) {
            console.warn('[dsh-session-inbox] openSession failed:', err)
          }
          try {
            const layout = serviceOf(ctx, 'layout')
            if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(null)
          } catch (err) {
            /* the conversation may already be showing; a shell without layout is fine */
          }
        }

        /** Show this panel in the center column. */
        const openPanel = () => {
          try {
            const layout = serviceOf(ctx, 'layout')
            if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
          } catch (err) {
            /* a shell without a layout face cannot switch panels */
          }
        }

        const disposers = []
        const face = () => ({ t, openSession })
        try {
          disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: PANEL_ORDER,
            label: () => t('panel.label'),
            inject: () => ({ t }),
          }, PanelIcon)))
        } catch (err) {
          console.warn('[dsh-session-inbox] sidebar entry registration failed:', err)
        }
        try {
          disposers.push(ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
            inject: face,
          }, ActivityPanel)))
        } catch (err) {
          console.warn('[dsh-session-inbox] panel registration failed:', err)
        }
        // The counts now ride on the panel row itself (see useRowBox), so the
        // footer strip is off by default. Flip this to true to bring back the
        // bottom-of-sidebar variant instead of / alongside the row numbers.
        if (FOOTER_STRIP === true) {
          try {
            disposers.push(ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
              name: 'sidebar.footer.action',
              id: PANEL_ID,
              order: 20,
              label: () => t('panel.label'),
              inject: () => ({ t, openPanel }),
            }, SidebarStats)))
          } catch (err) {
            console.warn('[dsh-session-inbox] sidebar footer registration failed:', err)
          }
        }

        return () => {
          for (const dispose of disposers.splice(0)) {
            try {
              dispose()
            } catch (err) {
              /* already disposed with its owner */
            }
          }
          services.ctx = null
          services.list = null
          services.status = null
        }
      }

      return { name, inject, apply }
    },
  })
})()
