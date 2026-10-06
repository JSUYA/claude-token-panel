import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Flash, Row, Usage } from '../types'
import { tally } from './tally'

const PANE = 'token-cost'
const OPEN = { id: PANE, title: 'Token cost', columns: 49 }
// Column widths in cells: 3, 10 for the model, 7 per token count, 8 for the cost.
const WIDTH = 49
const HEAD = ['  #', ' model    ', '     in', '    out', ' cacheR', ' cacheW', '    cost']
const COUNTS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const
const NONE: Usage = { path: null, rows: [] }
const DARK: Flash = null
const usage = atom({ plugin: 'token-cost', key: 'usage' } as const, NONE)
const flash = atom({ plugin: 'token-cost', key: 'flash' } as const, DARK)

const tokens = (n: number): string =>
  n < 1000 ? String(n) : n < 1e6 ? `${(n / 1e3).toFixed(1)}k` : `${(n / 1e6).toFixed(2)}M`

const line = (
  label: string,
  model: string,
  of: (key: (typeof COUNTS)[number] | 'usd') => number,
  isUnpriced: boolean,
): string[] => [
  label.padStart(3),
  ` ${model.padEnd(9)}`,
  ...COUNTS.map(key => tokens(of(key)).padStart(7)),
  `${isUnpriced ? '?' : '$'}${of('usd').toFixed(2)}`.padStart(8),
]

// Counts the session again from its transcript, and its subagents' beside it.
// ponytail: every file is read whole each time, tail them if a session's transcripts grow past tens of MB
const refresh = async ($: EngineInterface, seen?: string): Promise<void> => {
  const path = seen ?? (await read($, usage)).path

  if (path === null) {
    return
  }

  const folder = path.replace(/\.jsonl$/, '/subagents')
  const entries = (await $.fs.exists(folder)) ? await $.fs.list(folder) : []
  const agents = await Promise.all(
    entries
      .filter(entry => entry.name.endsWith('.jsonl'))
      .map(entry => $.fs.read(`${folder}/${entry.name}`)),
  )
  const rows = tally(await $.fs.read(path), agents)

  await update($, usage, () => ({ path, rows }))
}

// The running beat's timer: a module's own, so a reload drops it with the module.
let beat: Timer | undefined

// Brings the prompt's row into view and beats its border for three seconds.
const reveal = async ($: EngineInterface, uuid: string): Promise<void> => {
  // A row that cannot be brought into view says why; one already in view still beats.
  const { deny } = await $.ui
    .scroll({ to: { requestId: uuid }, block: 'center' })
    .catch((error: unknown) => ({ deny: String(error) }))

  if (deny !== undefined) {
    $.ui.toast(`Token cost: ${deny}`)
  }

  let beats = 0
  beat?.cancel()
  await update($, flash, () => ({ uuid, isOn: true }))
  beat = $.clock.every(500, () => {
    beats += 1

    if (beats >= 6) {
      beat?.cancel()
    }

    void update($, flash, () => (beats < 6 ? { uuid, isOn: beats % 2 === 0 } : null))
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: PANE,
      description: 'Show or hide the per-prompt token usage and cost pane',
    })
    // A reload drops the timer: no beat is left running.
    await update($, flash, () => null)

    const known = (await read($, usage)).path
    // Until a classic event names the transcript, look where the CLI keeps it.
    const guess = `${await $.env.get('HOME')}/.claude/projects/${(await $.session.root()).replace(/[^a-zA-Z0-9]/g, '-')}/${await $.session.id()}.jsonl`

    if (known !== null) {
      await refresh($)
    } else if (await $.fs.exists(guess)) {
      await refresh($, guess)
    }

    if ((await $.store.get('isOff')) !== true) {
      void $.ui.open(OPEN)
    }

    return next(e)
  })

  on('command.run', { command: PANE }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)
    await $.store.set('isOff', isOpen)

    if (isOpen) {
      await $.ui.close({ id: PANE })

      return { text: 'Token cost pane off.' }
    }

    await $.ui.open(OPEN)

    return { text: 'Token cost pane on.' }
  })

  on('classic.SessionStart', async ($, e, next) => {
    await refresh($, e.transcript_path)

    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await refresh($, e.transcript_path)

    return next(e)
  })

  on('classic.PostToolUse', async ($, e, next) => {
    await refresh($, e.transcript_path)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    await refresh($)
    // The turn's last response may reach the file a moment after the turn ends.
    $.clock.after(1000, () => void refresh($))

    return ended
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { rows } = await read($, usage)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 6)
    // Above the prompt the table spreads over the pane's width; docked it stays compact.
    const spare = e.props.placement === 'inline' ? e.props.bodyColumns - WIDTH : 0
    const gap = ' '.repeat(Math.max(0, Math.floor(spare / (HEAD.length - 1))))

    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">
          {HEAD.join(gap)}
        </Text>
        {rows.length === 0 && <Text dimColor>No prompts yet.</Text>}
        {rows
          .map((row: Row, i) => (
            <Button
              key={`row:${row.uuid}`}
              plain
              label={line(String(i + 1), row.model, key => row[key], row.isUnpriced).join(gap)}
              onPress={() => reveal($, row.uuid)}
            />
          ))
          .slice(-room)}
        <Text bold wrap="truncate-end">
          {line(
            'sum',
            '',
            key => rows.reduce((sum, row) => sum + row[key], 0),
            rows.some(row => row.isUnpriced),
          ).join(gap)}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const lit = await read($, flash)

    if (lit?.uuid !== e.requestId) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box borderStyle="round" borderColor="red" borderDimColor={!lit.isOn} paddingX={1}>
        <Text bold={lit.isOn}>{e.props.text}</Text>
      </Box>
    )
  })
}
