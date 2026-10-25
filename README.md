# Terminal Slots

Slots, video poker, Battleship and a Pomodoro timer in a side pane of [Claude Code](https://code.claude.com), for
something to do while Claude works. Claude's own work plays too: a busy turn spins the reels or deals a
hand, and a commit, a pull request or tests passing again earn a bonus. Everything runs on your
machine. No sign-in, no tokens, nothing to buy.

An independent plugin by [altoption](https://github.com/altoption). Not made or endorsed by Anthropic.

<p>
  <img src="docs/slots.svg" alt="The Slots tab in Claude Code: a 5 by 3 grid of farm symbols with a winning line of hay highlighted" width="508">
  <img src="docs/poker.svg" alt="The Poker tab in Claude Code: five cards with a pair of aces held, ready to draw" width="508">
</p>

## Install

You need Claude Code installed. In your terminal:

```
claude plugin marketplace add https://github.com/altoption/slots.git
claude plugin install terminal-slots@terminal-slots
```

Then start `claude`; the pane opens on the right (or type `/slots`). The
[website](https://terminal-slots.altoption.workers.dev) has a one-click button that types the install
request into Claude Code for you.

Use the full `https://…/slots.git` address as shown: with the short `altoption/slots` form, updates
from inside Claude Code need a GitHub SSH key.

### Updates

- **Automatic (recommended):** in Claude Code, open `/plugin`, choose **Marketplaces**, then
  **terminal-slots**, then **Enable auto-update**. Claude Code then picks up new releases on its own.
- **By hand:** `claude plugin update terminal-slots@terminal-slots`, then restart Claude Code.

What changed in each release: [CHANGELOG](CHANGELOG.md).

### Install trouble?

- *"Repository not found"*: check the address, `https://github.com/altoption/slots.git`.
- *"Cannot add marketplace "terminal-slots": its source doesn't match"*: you added it before under the
  short `altoption/slots` form. Run `claude plugin marketplace remove terminal-slots`, then the two
  install commands above.
- Don't use `sudo`: plugins install for your own user.
- *Pane not showing*: it opens on the right when the terminal is at least ~144 columns wide; `/slots`
  or the **Show** button above the prompt opens it at any width.
- *"hooks module did not load"*: your Claude Code is older than the plugin needs. Update Claude Code
  and restart it.

## Play

- **Slots**: Barn of Fortune, 5 reels × 3 rows, 10 lines. Press **SPIN** as often as you like.
- **Poker**: Royal Draw, Jacks or Better. DEAL, then click a card (or press 1–5) to hold it, then
  DRAW. A dealt hand that already pays starts held, as on a real machine.
- **Battleship**: a 10×10 sea hides five ships. Click a square to fire; sink the fleet in as few shots
  as you can. When the last ship goes down, the pane names the winning shot: who fired, where, and what
  it sank. A game in progress keeps across restarts.
- **Claude plays too**: when Claude finishes a turn that used 3 or more tools, the open tab plays once:
  Slots spins; Poker deals, and draws by itself after 4 seconds unless you change a hold; Battleship
  fires one aimed shot. Nothing plays on the Pomodoro tab or while the pane is hidden.
- **🤖 Claude deals: On/Off**: one switch for every game. Off, Claude's turns play nothing and you play
  everything by hand. It stays as you set it.
- **🏆 Bonus**: when Claude makes a commit, opens a pull request (`gh pr create`), or gets failing tests
  passing again, your next spin or deal is a bonus: a spin that pays at least 10× the bet, or a deal of
  Three of a Kind or better. On Battleship it's a shot sure to hit.
- **Pomodoro**: 25 minutes of focus, a 5-minute break, and a 15-minute break after every fourth.
  Start, Pause, Reset or Skip; a notice pops up when each one ends, and the time left shows above the
  prompt. It keeps running across restarts.
- Wins are points, for fun: nothing is bet, bought or paid out.
- A band above the prompt has **Show/Hide** for the pane.

## How the games work

- The games run on slots-sdk, the author's MIT-licensed slot engine, bundled in
  [`plugin/hooks/engine/`](plugin/hooks/engine). Every play is a function of a random seed, so any
  play can be replayed from its seed.
- Barn of Fortune publishes a 97.48% return, 1.35 points of it from a free-spins feature this plugin
  doesn't run, so the base game is 96.13%. Royal Draw uses the 9/6 Jacks or Better paytable.
- **Bonus plays are picked to win**: the plugin tries random seeds until one meets the bonus bar
  (up to 1,500 tries, keeping the best). They are a reward, not part of the published returns.

## What the plugin does on your machine

Everything it does, so you can check it against the code in [`plugin/hooks/`](plugin/hooks):

| What | Where | Details |
|---|---|---|
| Network | none | The plugin makes no network calls. |
| Opens your browser | `sponsor()` | Only `github.com/sponsors/altoption`, when you press 💖 Sponsor. |
| Stores locally | Claude Code's plugin store | Your points, a waiting bonus, your Battleship game, the Claude deals setting, your Pomodoro timer, and Claude's calibration stats. |
| Gives Claude one tool | `wager` | Claude can record how likely it thinks a test run is to pass before running it. The plugin doesn't change Claude's system prompt. |
| Watches tool calls | `tool.call` hook | Counts Claude's tool calls per turn, and reads the text of Bash commands **locally** to spot test runs, commits and `gh pr create`. Never sent anywhere; never blocks or changes a tool call. |
| Watches turns end | `turn.complete` hook | To play once after a busy turn. It never changes Claude's answer. |

### Claude's calibration

Before a test run, Claude records how likely it thinks the tests are to pass. Afterwards the pane
shows how well-calibrated it was (Brier score: 0 is perfect, 0.25 is a coin flip). It's a light way to
see whether "this should work ✅" means anything.

## Support

If you enjoy it, **💖 Sponsor** opens [github.com/sponsors/altoption](https://github.com/sponsors/altoption)
(pay what you can). It's a thank-you: it unlocks and buys nothing, and the game is the same for everyone.

## Feedback

Bug reports and ideas are welcome as [issues](https://github.com/altoption/slots/issues). Security
problems: see [SECURITY.md](SECURITY.md).

## License

All rights reserved. You're welcome to read the code, and to install and use the plugin from this
repository. Please don't redistribute it. Pull requests can't be accepted yet; open an issue instead.
