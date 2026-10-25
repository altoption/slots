# Terminal Slots

Slots and video poker in a side pane of [Claude Code](https://code.claude.com), for something to do
while Claude works. Free tokens, a leaderboard, and nothing to buy.

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

Then start `claude`, type `/slots`, and press **Sign in with GitHub**. The
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

- **Slots**: Barn of Fortune, 5 reels × 3 rows, 10 lines. Bets 10/20/50/100.
- **Poker**: Royal Draw, Jacks or Better. Deal, then click a card (or press 1–5) to hold it, then
  DRAW. A dealt hand that already pays starts held, as on a real machine. Bets 5/10/25/50/100.
- **Tokens**: 1,000 when you sign up. **🎁 Free tokens** gives more every 4 hours (100 to 10,000). If
  you run out, a free refill (+500) is available once a day.
- **💰 I'm Rich :)** opens the creator's GitHub Sponsors page, if you'd like to tip. It buys no tokens.
- A band above the prompt shows your balance, with **Show/Hide** for the pane. `/slots logout` signs out.

## Fair play: what you can check

- **The server decides every outcome.** The plugin sends your bet; the server picks the random seed
  and runs the game engine. The plugin only draws the result, so it can't be tweaked to win.
- The games run on slots-sdk, the author's slot engine (not public yet), where every spin is a
  function of its seed and can be replayed.
  - Barn of Fortune publishes a 97.48% return. 1.35 points of that come from a free-spins feature
    this plugin **doesn't run yet**, so the base game is 96.13%. Wins are paid in whole tokens,
    rounded down, which costs a little more: measured over 200,000 spins per bet size, players get
    about **94.4–96.4%** depending on the bet.
  - Royal Draw uses the 9/6 Jacks or Better paytable. Video poker's return depends on which cards
    you hold.
- **Tokens have no value.** They can't be bought, sold, transferred or cashed out, and nothing pays
  out. For entertainment only.

## What the plugin does on your machine

Everything it does, so you can check it against the code in [`plugin/hooks/`](plugin/hooks):

| What | Where | Details |
|---|---|---|
| Talks to one server | `register.tsx` `api()` | Only `https://terminal-slots.altoption.workers.dev` (fixed in the code). Sends game actions (spin, deal, draw, free tokens, refill), sign-in, and your session token. Nothing about your code, prompts or Claude's work. |
| Opens your browser | `signIn()`, `imRich()` | Only GitHub's own pages: the sign-in page, and `github.com/sponsors/altoption` when you press I'm Rich. |
| Stores locally | Claude Code's plugin store | Your session token for the game server, and Claude's calibration stats. |
| Gives Claude one tool | `wager` | Claude can record how likely it thinks a test run is to pass before running it. The plugin doesn't change Claude's system prompt. |
| Watches tool calls | `tool.call` hook | Reads the text of Bash commands **locally** to spot test runs (`npm test`, `pytest`, …) and whether they passed, to score Claude's calibration (a Brier score shown in the pane). Never sent anywhere; never blocks or changes a tool call. |

### Claude's calibration

Before a test run, Claude records how likely it thinks the tests are to pass. Afterwards the pane
shows how well-calibrated it was (Brier score: 0 is perfect, 0.25 is a coin flip). No tokens are at
stake. It's a light way to see whether "this should work ✅" means anything.

## What the server stores

Your GitHub user ID and login (from sign-in), a hash of your session token (never the token itself),
and your game records: balance, a ledger of every token movement, and an open poker hand. GitHub's
own access token is used once at sign-in to learn who you are, then discarded. Your login and
balance appear on the public leaderboard.

## Support

If you enjoy it, you can chip in through GitHub Sponsors (pay what you can, from $1/month). It's a
thank-you, not a purchase: supporters get their name in rainbow letters with a gold ★, and gold
cards; tokens stay free and the same for everyone. Sponsor at [github.com/sponsors/altoption](https://github.com/sponsors/altoption), using the same GitHub account you
play with; your ★ appears within a minute.

## Feedback

Bug reports and ideas are welcome as [issues](https://github.com/altoption/slots/issues). Security
problems: see [SECURITY.md](SECURITY.md).

## License

All rights reserved. You're welcome to read the code, and to install and use the plugin from this
repository. Please don't redistribute it. Pull requests can't be accepted yet; open an issue instead.
