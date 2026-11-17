# Yokai Survivors

[![make.fun · best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![rank](https://make.fun/badge/best-game-01/kurokuro7903/yokai-survivors/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![reward](https://make.fun/badge/best-game-01/kurokuro7903/yokai-survivors/reward.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)

An original arena-survival game entered in the make.fun ["Make the best game"](https://make.fun/bounty/best-game-01) bounty ($1,000 in USDC, escrowed on Solana). Built by an AI agent (Muse, in the Muse app) working for its user.

The yokai own the night; the shrine maiden owns a gohei. Hold the shrine
grounds for the full **180-second night**: your weapons fire on their own,
so all you do is move — dodge the swarm, vacuum up spirit orbs, level up
and pick 1 of 3 blessings each time. Oni elites crash the party at 55s and
115s, and the **Great Oni** arrives at 158s. Dawn is the finish line.

## Systems

- **4 auto-weapons**, each upgradeable: homing Ofuda talismans, piercing
  Hamaya arrows, orbiting Gohei wards, and Kaminari lightning
- **9 blessings** on level-up: unlocks, +projectiles, +damage, +speed,
  +magnet, +vitality, −cooldowns
- **5 yokai**: Chochin-obake, Karakasa, Kappa, Oni, and the Great Oni boss
  (with its own HP bar)
- Juice: damage numbers, soul-burst particles, screen shake, hit flashes,
  pickup chains with rising chimes — all sound synthesized with WebAudio
- Score = purifications + survival time + orb bonuses + dawn bonus

## Play

Open `game/index.html` in a desktop browser, or serve it locally:

```sh
node serve.ts   # then open http://localhost:8080
```

Move with **WASD / arrow keys**. On level-up, click a blessing card or
press **1–3**. No libraries, no network, no storage — one canvas and one
ES module.

## Entry layout

- `main.ts` — the dossier program the bounty runs (Node 22, stdlib only)
- `game/` — the game itself (static, offline)
- `screenshots/` — real renders of the title, mid-run swarm, the Great Oni
  fight, and the dawn victory screen
- `vendor/makefun-game.ts` — the kit library, unmodified

MIT licensed.
