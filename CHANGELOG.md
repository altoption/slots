# Changelog

Every release of the Terminal Slots plugin. Install or update with
`claude plugin update terminal-slots@terminal-slots`, then restart Claude Code.

## [0.9.2] - 2026-10-25

### Fixed
- The ★ Support buttons sat on a line of their own, under I'm Rich and the free refill; they're back
  in the same row.

## [0.9.1] - 2026-10-25

### Fixed
- SPIN and DEAL can't be pressed when the bet is more than your balance; the pane says why
  ("Bet 20 is more than your 17 tokens. Lower the bet.").
- Support buttons use a solid ★, which every terminal draws the same.

### Changed
- Claude's calibration line stays hidden until Claude has made its first prediction, and reads in
  plain words ("Claude's test predictions: 3 · Brier 0.120 (0 is perfect)").
- Shorter poker hint and slots caption, so both fit narrow panes.

## [0.9.0] - 2026-10-25

### Added
- After I'm Rich :), players who don't support the game yet see "Enjoying it? ⭐ Support the creator"
  until their next action. Supporting still buys no tokens.

### Fixed
- A supporter's rainbow name was drawn one letter per line; it now reads inline.

## [0.8.0] - 2026-10-25

### Added
- Supporters' names are drawn in rainbow letters with a gold ★, the way Claude Code draws "ultrathink".

### Changed
- The supporter star is a solid ★, which every terminal font draws the same (⭐ showed as ☆ in some).
- Shorter poker hint, so it fits narrow panes.

## [0.7.0] - 2026-10-25

### Changed
- The plugin no longer adds a paragraph to Claude's system prompt. The `wager` tool's own description
  now tells Claude when to use it.

### Fixed
- The plugin failed to load on older Claude Code builds that don't support adding to the system
  prompt. Updating Claude Code also fixes it.

## [0.6.2] - 2026-10-25

### Added
- Author, homepage and repository in the plugin manifest, shown in Claude Code's plugin details.
- This changelog, and a check that every plugin change bumps the version and adds an entry here.

## [0.6.1] - 2026-10-25

### Fixed
- Hearts and diamonds are red, spades and clubs keep the text colour, in every pane width.

## [0.6.0] - 2026-10-24

### Added
- Animated reels: they blur while spinning and stop one after another, left to right.
- Each reel cell is a bordered box; winning cells turn gold once the reels stop.

### Changed
- VS Code and mobile, which can't run the animated reels, keep the text grid.

## [0.5.0] - 2026-10-24

First public release.

### Added
- Slots (Barn of Fortune) and video poker (Royal Draw, Jacks or Better) in a side pane.
- GitHub sign-in, 1,000 starting tokens, I'm Rich :) free tokens every 4 hours, a daily refill when
  you run out, and a leaderboard.
- Poker: a paying dealt hand starts held; click a card or press 1–5 to hold or release it.
- A band above the prompt with your balance and Show/Hide for the pane.
- Claude's calibration: Claude records how likely it thinks tests are to pass, and the pane shows
  its Brier score.
