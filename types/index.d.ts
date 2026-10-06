// One prompt of the session: `id` is the transcript's promptId, `uuid` the
// prompt row's own id (what its UserMessage draws under).
export type Row = {
  id: string
  uuid: string
  // The main loop's model for the prompt, shortened for the table (`fable-5-1`).
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number
  // True when a model no rate is known for answered: `usd` leaves its tokens out.
  isUnpriced: boolean
}

export type Usage = { path: string | null; rows: Row[] }

// The prompt row whose border beats after its pane row was pressed.
export type Flash = { uuid: string; isOn: boolean } | null

declare module 'claude-code' {
  interface PluginState {
    'token-cost': { usage: Usage; flash: Flash }
  }
}
