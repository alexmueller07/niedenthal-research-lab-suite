import { useState } from "react";
import NumberScale from "../components/NumberScale";
import QuestionnairePage from "../components/QuestionnairePage";
import type { ClassificationTaskProps } from "./types";

// The first thing a participant does on the computer, before any video.
//
// Randy added these on 2026-07-31. They are the paper post-conversation
// questionnaire — affective agency, predictability, conversation quality,
// social connection — moved into the app, and they run at the very front of the
// session on purpose: every later screen (watching the conversation back, rating
// clips) reshapes how the conversation is remembered, so these have to be asked
// before any of that happens.
//
// Wording and scale are the paper wording and the paper scale (0-10, "Not at
// all" to "Very much"), unchanged. The relative-talking item keeps its own
// -5 … +5 scale with a middle anchor.
//
// Item order is FIXED, not shuffled. These mirror a paper instrument the lab has
// already run; reordering them would make the app data non-comparable with the
// pilot's paper data for no benefit.

interface Item {
  /** Stable key written to the data file. */
  key: string;
  label: string;
}

const AGENCY_ITEMS: Item[] = [
  {
    key: "influence_partner",
    label: "To what extent do you feel YOU were influencing YOUR PARTNER'S emotions?",
  },
  {
    key: "influenced_by_partner",
    label: "To what extent do you feel YOUR PARTNER was influencing YOUR emotions?",
  },
  {
    key: "predict_partner",
    label: "To what extent do you feel you could predict YOUR PARTNER'S emotions?",
  },
  { key: "flow", label: "How well did the conversation “flow”?" },
  {
    key: "enjoyment",
    label: "How much did you enjoy the conversation you had with your study partner?",
  },
  {
    key: "fits_with_friends",
    label: "Can you picture your study partner fitting in with your friends?",
  },
  {
    key: "friendship",
    label: "How much would you like to be friends with your study partner?",
  },
  { key: "comfort", label: "How comfortable did you feel during the conversation?" },
  {
    key: "self_focus",
    label: "How much were you focused on yourself during the conversation?",
  },
];

const TALK_ITEM_KEY = "relative_talking";
const TALK_ITEM_LABEL =
  "Think about how much you and your study partner each talked during your conversation, and indicate your relative contributions on the scale below:";

export interface PostConversationResult {
  /** Keyed by item key; 0-10 for the agency items, -5…+5 for relative talking. */
  responses: Record<string, number>;
  /** The order items were presented in, for the record. */
  order: string[];
  labels: Record<string, string>;
}

export default function PostConversation({ onContinue }: ClassificationTaskProps) {
  const [responses, setResponses] = useState<Record<string, number>>({});

  const set = (key: string, value: number) =>
    setResponses((prev) => ({ ...prev, [key]: value }));

  const answered = AGENCY_ITEMS.filter((i) => responses[i.key] !== undefined).length;
  const complete =
    answered === AGENCY_ITEMS.length && responses[TALK_ITEM_KEY] !== undefined;

  const labels: Record<string, string> = {
    ...Object.fromEntries(AGENCY_ITEMS.map((i) => [i.key, i.label])),
    [TALK_ITEM_KEY]: TALK_ITEM_LABEL,
  };

  return (
    <QuestionnairePage
      title="Thinking back on the conversation you just had, please answer the following."
      valid={complete}
      onSubmit={() =>
        onContinue?.({
          responses,
          order: [...AGENCY_ITEMS.map((i) => i.key), TALK_ITEM_KEY],
          labels,
        })
      }
      frameClassName="bg-black border p-8 w-10/12 mx-auto flex-1 flex flex-col justify-center"
    >
      <div className="w-full">
        {AGENCY_ITEMS.map((item) => (
          <NumberScale
            key={item.key}
            label={item.label}
            min={0}
            max={10}
            leftLabel="Not at all"
            rightLabel="Very much"
            value={responses[item.key]}
            onChange={(value) => set(item.key, value)}
          />
        ))}

        <NumberScale
          label={TALK_ITEM_LABEL}
          min={-5}
          max={5}
          leftLabel="My study partner spoke much more than I did"
          centerLabel="My study partner and I spoke the same amount"
          rightLabel="I spoke much more than my study partner did"
          value={responses[TALK_ITEM_KEY]}
          onChange={(value) => set(TALK_ITEM_KEY, value)}
        />
      </div>
    </QuestionnairePage>
  );
}
