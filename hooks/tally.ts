import type { Row } from '../types'

// USD per million tokens at standard API rates, which an Enterprise plan bills
// usage at: [model id part, input, output, cache read]. The first match wins.
// A cache write costs 1.25x input (5 minutes) or 2x input (1 hour).
// ponytail: a table that rots, refresh it from platform.claude.com/docs/en/about-claude/pricing.
// Not priced: fast mode, US-only inference (1.1x), web search requests.
const RATES: readonly (readonly [string, number, number, number])[] = [
  ['claude-fable-5-1', 10, 50, 0.25],
  ['claude-mythos-5-1', 10, 50, 0.25],
  ['claude-fable-5', 10, 50, 1],
  ['claude-mythos-5', 10, 50, 1],
  ['claude-opus-5-5', 4, 20, 0.2],
  ['claude-opus-4-1', 15, 75, 1.5],
  ['claude-opus-4-2', 15, 75, 1.5],
  ['claude-opus', 5, 25, 0.5],
  ['claude-sonnet-5', 2, 10, 0.2],
  ['claude-sonnet', 3, 15, 0.3],
  ['claude-haiku-4-5', 1, 5, 0.1],
]

// A response's usage as the transcript stores it; `iterations` splits it per
// request when one response held several (an advisor's call names its own model).
type Use = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_1h_input_tokens?: number }
  model?: string
  iterations?: Use[] | null
}

const spend = (row: Row, model: string, use: Use): void => {
  const input = use.input_tokens ?? 0
  const output = use.output_tokens ?? 0
  const read = use.cache_read_input_tokens ?? 0
  const write = use.cache_creation_input_tokens ?? 0
  const hour = use.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const rate = RATES.find(([part]) => model.includes(part))

  row.input += input
  row.output += output
  row.cacheRead += read
  row.cacheWrite += write

  if (rate === undefined) {
    row.isUnpriced ||= input + output + read + write > 0

    return
  }

  const [, perInput, perOutput, perRead] = rate
  row.usd +=
    (input * perInput +
      (write - hour) * perInput * 1.25 +
      hour * perInput * 2 +
      read * perRead +
      output * perOutput) /
    1e6
}

/**
 * The session's prompts with what each one used, from its transcript's text
 * and its subagents' transcripts: a subagent counts toward the prompt that
 * spawned it.
 */
export const tally = (main: string, agents: readonly string[] = []): Row[] => {
  const rows: Row[] = []

  for (const text of [main, ...agents]) {
    // A response is stored once per content block, each copy with the whole usage.
    const responses = new Map<string, { row: Row; model: string; usage: Use }>()
    let row: Row | undefined

    for (const line of text.split('\n')) {
      let entry

      try {
        entry = JSON.parse(line)
      } catch {
        // A blank line, or one still being written.
        continue
      }

      if (entry?.type === 'user' && typeof entry.promptId === 'string' && entry.promptId !== row?.id) {
        row = rows.find(known => known.id === entry.promptId)

        if (row === undefined && text === main) {
          row = {
            id: entry.promptId,
            uuid: String(entry.uuid),
            model: '',
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            usd: 0,
            isUnpriced: false,
          }
          rows.push(row)
        }
      }

      const message = entry?.type === 'assistant' ? entry.message : undefined
      const owner = responses.get(message?.id)?.row ?? row ?? rows.at(-1)

      if (message?.usage && owner !== undefined) {
        responses.set(message.id, { row: owner, model: String(message.model), usage: message.usage })
      }
    }

    for (const { row: owner, model, usage } of responses.values()) {
      // The prompt's model is its own loop's last, never a subagent's or a made-up row's.
      if (text === main && !model.startsWith('<')) {
        owner.model = model.replace(/^.*claude-/, '').replace(/-\d{8}$/, '').slice(0, 9)
      }

      for (const use of usage.iterations?.length ? usage.iterations : [usage]) {
        spend(owner, use.model ?? model, use)
      }
    }
  }

  return rows
}
