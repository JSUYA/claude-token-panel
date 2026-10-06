# claude-token-panel-mod

A Claude Code mod that shows, for every prompt of the session, how many tokens it used and what it cost.

![The pane docked beside the transcript](docs/screenshot.png)

```
  # model         in    out cacheR cacheW    cost
  1 fable-5-1     12   1.7k 241.8k  65.1k   $1.45
  2 fable-5-1  85.7k   8.3k 601.2k  21.6k   $1.84
sum            85.7k  10.0k 843.0k  86.7k   $3.29
```

## Install

Requires Claude Code 2.1.287 or newer. At the prompt of a terminal session:

```
/plugin install token-panel --marketplace JSUYA/claude-token-panel-mod
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

## Use

- `/token-panel` shows or hides the pane. The choice is remembered across sessions.
- In the fullscreen layout, on a terminal at least 110 columns wide, the pane docks beside the transcript. Otherwise it opens above the prompt and spreads its columns over the width.
- Press a row (click it, or `ctrl+x tab`, Tab to the row, Enter) to scroll the transcript to that prompt; its border beats red for three seconds.

## What is counted

- The numbers come from the session's transcript file, so prompts sent before the mod loaded are listed too.
- A subagent's tokens count toward the prompt that spawned it, priced at the subagent's own model.
- An advisor call is counted as its own request, priced at the advisor's model.
- Internal calls that leave no transcript row (a web search's own request, title and summary generation) are added to `cost` only: the engine's cost total is compared with the transcripts', and what it billed beyond them goes to the prompt it fell in. Their tokens are not known, so the token columns leave them out. This starts when the mod first loads in a session.
- The `sum` row is the engine's cost total, the figure `/cost` shows. What the engine billed that no prompt's row holds (internal calls from before the mod first loaded in the session) is listed as `etc unplaced`.
- `model` is the main loop's model for the prompt.
- The table refreshes after each tool call and when a turn ends.

## Cost

Cost is tokens times the standard API rates, which is what a usage-based Enterprise plan bills usage at. Cache writes are priced by their duration (5 minutes at 1.25x input, 1 hour at 2x).

- The rate table lives in `hooks/tally.ts` and has to be updated by hand when [prices](https://platform.claude.com/docs/en/about-claude/pricing) change.
- Not included: the 1.1x US-only inference multiplier, fast mode rates, and the per-request web search fee.
- A prompt answered by a model missing from the table shows `?` instead of `$`: the table could not price that model's tokens itself.

## Develop

```
claude --plugin-dir .        # run the mod from this folder, reloading on save
claude plugin validate .
claude plugin test .
```
