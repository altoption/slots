# Changelog

Every release of the Terminal Slots plugin. Install or update with
`claude plugin update terminal-slots@terminal-slots`, then restart Claude Code.

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
