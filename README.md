# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/arisawali2014/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/arisawali2014/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar built from the competition's sealed DefiLlama snapshot: 758 protocols with at least $5M TVL. The program scores and ranks protocols that have not launched a token yet by an implied valuation derived from the snapshot's own figures — TVL, 7-day TVL change and listing age — keeping already-tokened protocols separate from the pre-token set. It covers the full watchlist of 40 protocols with at least $50M TVL and no token, and every ranked row carries a concrete farm plan: the steps to position for a possible launch, with estimated costs and time. The output is a ranked `board.json`, a `dossier.json`, and a fully offline dashboard (no network references) with a sortable, filterable table and a per-protocol detail view.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ./input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=f17w6kqp&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
