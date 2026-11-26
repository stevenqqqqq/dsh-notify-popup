/**
 * Host half of @local/dsh-notify-popup.
 *
 * Raises a desktop popup when:
 *   - an agent turn is about to close (the task is finished), or
 *   - the agent is blocked waiting for an approval / an answer.
 *
 * Primary backend runs the sibling notify.ps1 through launch.vbs, executed by
 * wscript.exe — a GUI-subsystem binary that never creates a console, so no cmd
 * black box flashes on Windows. The script itself runs under powershell.exe
 * -Sta: a top-most WPF card in the bottom-right corner that fades in,
 * auto-closes, and closes on click — visible even when DSH is not in the
 * foreground. STA matters: WPF ShowDialog() throws without it. IMPORTANT:
 * never add detached:true to a PowerShell spawn — on Windows it starts
 * PowerShell without a console and the script exits 0 without doing anything.
 * Electron Notification stays only as a last-resort fallback.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { appendFileSync, existsSync } from 'node:fs'

const require = createRequire(import.meta.url)

const SCRIPT_PATH = fileURLToPath(new URL('./notify.ps1', import.meta.url))
const LAUNCHER_PATH = fileURLToPath(new URL('./launch.vbs', import.meta.url))

const DEFAULTS = {
  turnComplete: true,
  approval: true,
  question: true,
  onlyRootAgent: true,
  sound: true,
  durationMs: 9000,
  dedupeMs: 1200,
  diagnostics: true,
  logPath: join(tmpdir(), 'dsh-notify-popup.log'),
}

const lastFired = new Map()

function diag(config, msg) {
  if (!config || config.diagnostics === false) return
  try {
    const d = new Date()
    const pad = function (n) { return String(n).padStart(2, '0') }
    const stamp =
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
    appendFileSync((config && config.logPath) || DEFAULTS.logPath, stamp + ' [plugin] ' + msg + '\n')
  } catch {}
}

function text(value, fallback) {
  if (value == null) return fallback || ''
  const s = String(value).replace(/\s+/g, ' ').trim()
  return s || fallback || ''
}

function clip(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s
}

function isRootAgent(agent) {
  if (!agent || typeof agent !== 'object') return true
  const opts = agent.options
  if (opts && typeof opts === 'object') {
    const depth = Number(opts.subagentDepth)
    if (Number.isFinite(depth) && depth > 0) return false
  }
  if (agent.parent || agent.parentAgent || agent.parentId || agent.parentSessionId) return false
  if (typeof agent.depth === 'number' && agent.depth > 0) return false
  return true
}

function sessionHint(agent) {
  const candidates = [
    agent && agent.session && agent.session.title,
    agent && agent.sessionTitle,
    agent && agent.title,
    agent && agent.name,
  ]
  for (const value of candidates) {
    const s = text(value, '')
    if (s) return s
  }
  return ''
}

function probeAgent(agent) {
  try {
    if (!agent || typeof agent !== 'object') return String(agent)
    const keys = function (o) {
      return o && typeof o === 'object' ? Object.keys(o).slice(0, 24).join('|') : String(o)
    }
    const sess = agent.session
    return (
      'id=' + JSON.stringify(agent.id) +
      ' session.id=' + JSON.stringify(sess && sess.id) +
      ' session.title=' + JSON.stringify(sess && (sess.title || sess.name)) +
      ' sessionKeys=' + keys(sess) +
      ' optionsKeys=' + keys(agent.options) +
      ' scopeKeys=' + keys(agent.scope) +
      ' scope.parent=' + (agent.scope && agent.scope.parent ? 'yes' : 'no') +
      ' scope.name=' + JSON.stringify(agent.scope && agent.scope.name) +
      ' loopCtxKeys=' + keys(agent.loopCtx)
    )
  } catch (err) {
    return 'probe-error: ' + ((err && err.message) || err)
  }
}

function showElectron(title, body, config) {
  try {
    const electron = require('electron')
    const Notification = electron && electron.Notification
    if (!Notification) return false
    if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) return false
    const n = new Notification({ title: title, body: body, silent: !config.sound })
    n.show()
    return true
  } catch {
    return false
  }
}

function showPowerShell(title, body, config) {
  try {
    if (!existsSync(SCRIPT_PATH)) {
      diag(config, 'notify.ps1 missing at ' + SCRIPT_PATH)
      return false
    }
    if (!existsSync(LAUNCHER_PATH)) {
      diag(config, 'launch.vbs missing at ' + LAUNCHER_PATH)
      return false
    }
    // wscript.exe is a GUI-subsystem binary: no console window is ever created,
    // so the cmd black box cannot flash. It starts PowerShell hidden via Shell.Run.
    // Do NOT add detached:true (see header note).
    const child = spawn(
      'wscript.exe',
      [LAUNCHER_PATH],
      {
        stdio: 'ignore',
        windowsHide: true,
        env: Object.assign({}, process.env, {
          DSH_NOTIFY_TITLE: title,
          DSH_NOTIFY_BODY: body,
          DSH_NOTIFY_MS: String(config.durationMs),
          DSH_NOTIFY_SOUND: config.sound ? '1' : '0',
          DSH_NOTIFY_LOG: config.logPath || '',
        }),
      },
    )
    child.on('error', function (err) {
      diag(config, 'toast spawn error: ' + ((err && err.message) || err))
    })
    child.on('exit', function (code) {
      diag(config, 'toast process exited (' + code + ')')
    })
    child.unref()
    diag(config, 'toast spawned pid=' + (child && child.pid))
    return true
  } catch (err) {
    diag(config, 'toast spawn failed: ' + ((err && err.message) || err))
    return false
  }
}

function notify(opts, config) {
  const title = clip(text(opts && opts.title, 'DeepSeek Harness'), 120)
  const body = clip(text(opts && opts.body, ''), 400)
  const key = title + '\u0000' + body
  const now = Date.now()
  const prev = lastFired.get(key)
  if (prev && now - prev < config.dedupeMs) return
  lastFired.set(key, now)
  if (lastFired.size > 64) lastFired.clear()
  diag(config, 'notify: "' + title + '" ' + body.slice(0, 80))

  // The PowerShell card is the verified-visible path (top-most, survives the
  // DSH window losing focus). Prefer it; fall back to Electron only when a
  // PowerShell spawn cannot be started at all. Electron toast on Windows can
  // be created successfully yet silently fail to appear without a registered
  // AppUserModelID, which would defeat the whole point of this plugin.
  if (showPowerShell(title, body, config)) return
  showElectron(title, body, config)
}

export function apply(ctx, rawConfig) {
  const config = Object.assign({}, DEFAULTS, rawConfig || {})
  diag(
    config,
    'apply() loaded; hooks=' +
      ['turnComplete', 'approval', 'question'].filter(function (k) { return config[k] }).join('+'),
  )

  if (config.turnComplete) {
    ctx.on('agent/turn-stopping', function (payload) {
      try {
        const agent = payload && payload.agent
        if (config.onlyRootAgent && !isRootAgent(agent)) {
          diag(config, 'turn-stopping suppressed (non-root agent: ' + text(agent && agent.name, '?') + ')')
          return
        }
        if (payload && payload.signal && payload.signal.aborted) return
        const hint = sessionHint(agent)
        diag(
          config,
          'hook agent/turn-stopping fired (id=' + String((agent && agent.id) || '?') +
            '; subagentDepth=' + String(agent && agent.options && agent.options.subagentDepth) + ')',
        )
        diag(config, 'probe ' + probeAgent(agent))
        notify(
          {
            title: '任务已完成',
            body: hint
              ? hint + '：这一轮已经结束，可以回来查看结果了。'
              : 'DeepSeek Harness 这一轮已经结束，可以回来查看结果了。',
          },
          config,
        )
      } catch {}
    })
  }

  if (config.approval) {
    ctx.on('approval/request', async function (req, next) {
      try {
        diag(config, 'hook approval/request fired')
        const what = text(
          (req && (req.toolName || req.tool || req.name || req.title)) ||
            (req && req.request && (req.request.toolName || req.request.name)) ||
            '',
          '一个工具调用',
        )
        notify({ title: '需要你的确认', body: '有一个操作在等你批准：' + what }, config)
      } catch {}
      return next()
    })
  }

  if (config.question) {
    ctx.on('user-questions/request', async function (request, next) {
      try {
        diag(config, 'hook user-questions/request fired')
        const list = request && (request.questions || request.items)
        const first = Array.isArray(list) ? list[0] : null
        const q = text(
          (first && (first.question || first.header)) ||
            (request && (request.question || request.title)) ||
            '',
          '有一个问题在等你回答。',
        )
        notify({ title: '需要你的回答', body: q }, config)
      } catch {}
      return next()
    })
  }

  // ---------------------------------------------------------------------------
  // Fallback notification paths for approval / question.
  //
  // Observed in the live host: the two waterfall hooks above never fired even
  // though the dispatch sites exist in dsh-user-approval and dsh-user-questions
  // (both use scopeTarget(agent, agent)). Rather than guess, observe the bus
  // itself: Cordis emits `internal/dispatch` for every non-internal event
  // before listeners run. A global listener bypasses all scope filters, so it
  // sees approval/question requests no matter which scoped thisArg was used —
  // which is exactly what the scoped waterfall hooks above fail to do here.
  // This observer reuses notify(), so the existing 1200ms dedupe prevents
  // doubles if a normal hook ever does start firing.
  // ---------------------------------------------------------------------------
  function approvalNotice(req) {
    if (!config.approval) return
    const what = text(
      (req && (req.toolName || req.tool || req.name || req.title)) ||
        (req && req.request && (req.request.toolName || req.request.name)) ||
        '',
      '一个工具调用',
    )
    notify({ title: '需要你的确认', body: '有一个操作在等你批准：' + what }, config)
  }

  function questionNotice(request) {
    if (!config.question) return
    const list = request && (request.questions || request.items)
    const first = Array.isArray(list) ? list[0] : null
    const q = text(
      (first && (first.question || first.header)) ||
        (request && (request.question || request.title)) ||
        '',
      '有一个问题在等你回答。',
    )
    notify({ title: '需要你的回答', body: q }, config)
  }

  if (config.approval || config.question) {
    try {
      ctx.on('internal/dispatch', function (mode, name, args) {
        try {
          if (typeof name !== 'string') return
          const isApproval = name === 'approval/request' || /approval/i.test(name)
          const isQuestion = name === 'user-questions/request' || /user.question/i.test(name)
          if (!isApproval && !isQuestion) return
          diag(config, 'internal/dispatch ' + mode + ' ' + name + ' argc=' + (args && args.length))
          const req = args && args[0]
          if (isApproval) approvalNotice(req)
          else questionNotice(req)
        } catch (err) {
          diag(config, 'internal/dispatch observer error: ' + ((err && err.message) || err))
        }
      }, { global: true })
      diag(config, 'fallback registered: internal/dispatch observer')
    } catch (err) {
      diag(config, 'internal/dispatch observer registration failed: ' + ((err && err.message) || err))
    }
  }
}
