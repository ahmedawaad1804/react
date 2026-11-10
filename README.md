# Stable empty child slots in React

This benchmark measures synchronous updates to keyed siblings through React DOM in Chromium and React's internal Noop renderer. It compares the stable production builds of [`b05c0b75fd`](https://github.com/react/react/commit/b05c0b75fd9778536152eead30814c9ca90c810a) with the same source plus [`reconciler.patch`](./reconciler.patch). The candidate's `ReactChildFiber.js` SHA-256 is `624724a4a14915da0c9f66daa14c15f5f27a08f6e0b74125fc02d62e56cd836a`.

## Reproduce

The recorded run used Node 22.20.0, Yarn 1.22.22, Java 17.0.16, esbuild 0.25.10 and Playwright 1.62.1. Use a new output directory for the two React builds. The build script fetches the pinned upstream commit and applies only the reconciler change for the second build.

```sh
npm ci
npx playwright install chromium
bash build.sh ../empty-slot-builds
node run.cjs ../empty-slot-builds/baseline/node_modules \
  ../empty-slot-builds/patched/node_modules result.json 12
```

`run.cjs` also accepts production artifacts built separately. It checks that both the React DOM client and standalone reconciler differ between the two builds. The recorded run used the same installed dependencies for both variants. The upstream `yarn.lock` SHA-256 was `d5a67e3dcec1a22eae3178fd3160c394416b6f76475f45e11865d7542f97564f`.

## Workloads

- A function component renders a `<span>` containing its key and the current revision. Every update creates new React elements, increments the revision and updates the text of every rendered row.
- Arrays contain 1,000 or 10,000 slots. Iterable cases contain 1,000 slots and use a repeatable iterable wrapper over the array. Each size has a dense case and a case with a persistent `null` at index 1. That gap leaves 998 or 9,998 previously mounted siblings after it.
- An additional dense 1,000-slot array swaps its first two keyed rows on every update. That forces a genuine keyed mismatch near the start of the list.
- A fresh Node or Chromium process runs all seven cases for a single variant in each pair. Variant order alternates between pairs. Scenario order rotates between pairs and matches across the two variants within each pair.
- Timing starts after mount and warmup. Each 1,000-slot case gets 50 warmups and 18 timed batches of 48 updates. The 10,000-slot cases get 15 warmups and 18 timed batches of 5 updates. Each update flushes synchronously. The runner verifies the count, order and text of every row after mount, warmup and each batch. Validation and event-loop yields run outside the timer.
- The per-process observation is the median batch duration divided by updates per batch. Baseline and candidate times in the results are the medians of those observations. Paired time reduction is the median of `(baseline − candidate) / baseline` across the 12 process pairs. Positive values indicate shorter candidate update times. The interquartile range describes variation among pairs.

The experiment measures completed JS updates and synchronous host commits in these specific workloads. Browser layout and paint after the synchronous call fall outside the timer. ReactNoop, headless Chromium and a near-start gap do not characterize native renderers, interaction latency, the performance of smaller sibling sets, or typical application-wide gains.

## Recorded results

The run used Apple M3 Max on macOS 27.0 arm64, v22.20.0 for Node and Chromium 151.0.7922.34. The process pairs ran sequentially. The machine was connected to AC power throughout both endpoint readings. System load averages at the start and end are recorded in [the environment file](./environment.json). The benchmark ran alongside ordinary desktop processes.

| Renderer | Siblings | Baseline ms/update | Candidate ms/update | Paired time reduction, median [IQR] | Faster pairs |
| --- | --- | ---: | ---: | ---: | ---: |
| React DOM | array/1000/gap | 0.3594 | 0.3214 | +10.55% [+8.99%, +11.59%] | 12/12 |
| React DOM | array/1000/dense | 0.3177 | 0.3193 | -1.32% [-2.16%, +0.08%] | 3/12 |
| React DOM | array/10000/gap | 4.0450 | 3.5600 | +12.44% [+10.56%, +13.04%] | 12/12 |
| React DOM | array/10000/dense | 3.4750 | 3.5300 | -1.72% [-6.24%, +0.42%] | 3/12 |
| React DOM | iterable/1000/gap | 0.3708 | 0.3354 | +9.39% [+8.12%, +11.92%] | 12/12 |
| React DOM | iterable/1000/dense | 0.3245 | 0.3297 | -1.10% [-1.93%, -0.39%] | 3/12 |
| React DOM | array/1000/swap-first-two | 0.3620 | 0.3672 | -0.72% [-2.72%, +0.07%] | 3/12 |
| ReactNoop | array/1000/gap | 0.2479 | 0.1956 | +22.47% [+19.82%, +23.53%] | 12/12 |
| ReactNoop | array/1000/dense | 0.1939 | 0.1946 | +0.37% [-1.38%, +1.55%] | 8/12 |
| ReactNoop | array/10000/gap | 2.9211 | 2.1488 | +29.24% [+28.20%, +30.00%] | 12/12 |
| ReactNoop | array/10000/dense | 2.0718 | 2.1083 | +2.40% [-2.14%, +5.71%] | 8/12 |
| ReactNoop | iterable/1000/gap | 0.2606 | 0.2056 | +20.37% [+18.67%, +23.76%] | 12/12 |
| ReactNoop | iterable/1000/dense | 0.2038 | 0.2041 | +0.13% [-2.31%, +2.92%] | 6/12 |
| ReactNoop | array/1000/swap-first-two | 0.2532 | 0.2539 | -0.15% [-1.14%, +1.18%] | 5/12 |

[Per-pair measurements](./pairs.csv) · [All timed batches](./raw.json.gz) · [Build and machine metadata](./environment.json)
