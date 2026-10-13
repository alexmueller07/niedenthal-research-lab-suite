# Short-video clips: which five per round, and why

> **PROVISIONAL — for Ben to review.** Picked by `scripts/select-clips.py` on
> 2026-10-13 from the published Cowen & Keltner (2017) norms. Ships in Lab Suite
> 1.5.0. Changing a pick is one line in `src/station/video-task/videos.ts`.

Randy (2026-10-13): *5 videos per condition — 2 clearly positive, 2 clearly
negative, 1 mixed; flag which ones are selected.*

## How they were picked

Each of Ben's five groups of eight was cut to five **within the group**, so
round N still shows group N and nobody sees a clip twice across rounds.

For each clip, from the norms (the proportion of raters choosing each emotion):

- **positive** = admiration, adoration, aesthetic appreciation, amusement, awe,
  calmness, entrancement, excitement, interest, joy, nostalgia, pride, relief,
  romance, satisfaction, triumph
- **negative** = anger, anxiety, awkwardness, boredom, confusion, contempt,
  disappointment, disgust, empathic pain, envy, fear, guilt, horror, sadness
- **net** = positive − negative

The two highest-net clips are *positive*, the two lowest are *negative*, and of
the remaining four the *mixed* one has the most of both (largest
`min(pos, neg) − |pos − neg|`).

**Why not the CSV's `valence` column:** it does not agree with the categories.
Clip 0778, rated mostly amusement and joy, scores 2.4 out of 9, and `arousal` is
0 for every clip. It looks mis-joined, so it was not used. **The RA survey's
valence ratings would be a better source** if the lab would rather use them.
They also found group 1 more negative than groups 2 and 3.

## The selection

| Group | Clip | Role | Positive | Negative | Net |
|---|---|---|---|---|---|
| 1 | 1010 | positive | 1.75 | 0.33 | +1.42 |
| 1 | 0353 | positive | 1.54 | 0.31 | +1.23 |
| 1 | 2162 | negative | 0.33 | 1.04 | -0.71 |
| 1 | 1871 | negative | 0.42 | 0.83 | -0.42 |
| 1 | 0900 | mixed | 1.08 | 1.08 | +0.00 |
| 1 | dropped: 1919, 0283, 0778 | | | | |
| 2 | 1741 | positive | 1.31 | 0.15 | +1.15 |
| 2 | 0970 | positive | 1.42 | 0.42 | +1.00 |
| 2 | 1422 | negative | 0.54 | 1.23 | -0.69 |
| 2 | 1672 | negative | 0.50 | 0.92 | -0.42 |
| 2 | 1473 | mixed | 0.71 | 0.89 | -0.18 |
| 2 | dropped: 0603, 1335, 1077 | | | | |
| 3 | 1432 | positive | 1.62 | 0.23 | +1.38 |
| 3 | 0341 | positive | 1.31 | 0.23 | +1.08 |
| 3 | 1744 | negative | 0.38 | 1.38 | -1.00 |
| 3 | 1979 | negative | 0.58 | 1.25 | -0.67 |
| 3 | 1148 | mixed | 0.69 | 1.04 | -0.35 |
| 3 | dropped: 0607, 1306, 1430 | | | | |
| 4 | 0381 | positive | 1.75 | 0.25 | +1.50 |
| 4 | 1635 | positive | 1.25 | 0.42 | +0.83 |
| 4 | 0595 | negative | 0.16 | 2.03 | -1.88 |
| 4 | 0443 | negative | 0.42 | 1.04 | -0.62 |
| 4 | 1732 | mixed | 1.00 | 0.65 | +0.35 |
| 4 | dropped: 0338, 0336, 0559 | | | | |
| 5 | 0424 | positive | 1.19 | 0.23 | +0.96 |
| 5 | 0014 | positive | 1.25 | 0.33 | +0.92 |
| 5 | 0913 | negative | 0.54 | 2.08 | -1.54 |
| 5 | 0451 | negative | 0.50 | 1.17 | -0.67 |
| 5 | 0436 | mixed | 0.88 | 0.81 | +0.08 |
| 5 | dropped: 0908, 1017, 1770 | | | | |

"Surprise" counts toward neither side, which is why a clip such as 0353
(surprise, awe, anxiety) can rank as positive. The emotion words a participant
is asked about did not change: each clip still asks its own top three.
