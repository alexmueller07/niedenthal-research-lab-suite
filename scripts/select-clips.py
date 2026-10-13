"""Pick five clips per round from the forty in videos.ts: 2 positive, 2 negative, 1 mixed.

Randy, 2026-10-13: "Set up 5 videos per condition: 2 clearly positive, 2 clearly
negative, 1 mixed; flag which ones are selected." The pick is made inside each
existing group of eight, so the round-to-group rule (R1 = group 1 ...) and the
no-repeats-across-rounds guarantee both survive.

Scoring uses the Cowen & Keltner (2017) per-clip norms: the proportion of raters
who chose each emotion category. The CSV's own `valence` column is NOT used. It
does not track the categories (clip 0778, rated mostly amusement and joy,
scores 2.4 on 1-9, and `arousal` is 0 for every clip), so it looks mis-joined.

    positive = sum of the positive categories' proportions
    negative = sum of the negative categories' proportions
    net      = positive - negative

    2 positive = the two highest net
    2 negative = the two lowest net (ties: more negative mass first)
    1 mixed    = of the remaining four, the one with the most of BOTH:
                 max(min(pos, neg) - |pos - neg|)

This is a provisional, reproducible starting point for Ben to review. The RA
survey valence ratings would be the better source if the lab prefers them.

Usage:
    python scripts/select-clips.py path/to/CowenKeltnerEmotionalVideos.csv
"""

from __future__ import annotations

import csv
import sys
from dataclasses import dataclass
from pathlib import Path

# The groups as Ben sent them on 2026-09-20, in round order.
GROUPS: list[list[str]] = [
    ["2162", "0900", "1871", "0353", "1919", "0283", "0778", "1010"],
    ["1422", "0603", "1473", "1672", "0970", "1335", "1077", "1741"],
    ["1979", "1744", "0607", "1148", "1306", "1430", "0341", "1432"],
    ["0595", "0443", "0338", "1732", "0336", "1635", "0381", "0559"],
    ["0913", "0436", "0451", "0908", "0014", "1017", "0424", "1770"],
]

POSITIVE = [
    "Admiration", "Adoration", "Aesthetic Appreciation", "Amusement", "Awe",
    "Calmness", "Entrancement", "Excitement", "Interest", "Joy", "Nostalgia",
    "Pride", "Relief", "Romance", "Satisfaction", "Triumph",
]
NEGATIVE = [
    "Anger", "Anxiety", "Awkwardness", "Boredom", "Confusion", "Contempt",
    "Disappointment", "Disgust", "Empathic Pain", "Envy", "Fear", "Guilt",
    "Horror", "Sadness",
]


@dataclass(frozen=True)
class Clip:
    clip_id: str
    positive: float
    negative: float

    @property
    def net(self) -> float:
        return self.positive - self.negative

    @property
    def mixedness(self) -> float:
        return min(self.positive, self.negative) - abs(self.net)


@dataclass(frozen=True)
class Selection:
    positive: list[Clip]
    negative: list[Clip]
    mixed: Clip


def load_norms(path: Path) -> dict[str, dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return {row["Filename"].split(".")[0]: row for row in csv.DictReader(handle)}


def score(clip_id: str, norms: dict[str, dict[str, str]]) -> Clip:
    row = norms[clip_id]
    total = lambda names: sum(float(row[name] or 0) for name in names)  # noqa: E731
    return Clip(clip_id, total(POSITIVE), total(NEGATIVE))


def select(group: list[Clip]) -> Selection:
    by_net = sorted(group, key=lambda c: (-c.net, c.negative))
    positive = by_net[:2]
    negative = sorted(group, key=lambda c: (c.net, -c.negative))[:2]
    taken = {c.clip_id for c in positive + negative}
    rest = [c for c in group if c.clip_id not in taken]
    mixed = max(rest, key=lambda c: c.mixedness)
    return Selection(positive, negative, mixed)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    norms = load_norms(Path(argv[1]))
    print("| Group | Clip | Role | Positive | Negative | Net |")
    print("|---|---|---|---|---|---|")
    for number, ids in enumerate(GROUPS, start=1):
        clips = [score(clip_id, norms) for clip_id in ids]
        chosen = select(clips)
        roles = (
            [(c, "positive") for c in chosen.positive]
            + [(c, "negative") for c in chosen.negative]
            + [(chosen.mixed, "mixed")]
        )
        for clip, role in roles:
            print(
                f"| {number} | {clip.clip_id} | {role} | {clip.positive:.2f} "
                f"| {clip.negative:.2f} | {clip.net:+.2f} |"
            )
        dropped = [c.clip_id for c in clips if c not in [r[0] for r in roles]]
        print(f"| {number} | dropped: {', '.join(dropped)} | | | | |")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
