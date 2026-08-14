// Situational emotion-rating scenarios.
//
// RETIRED (2026-07-23), pending Randy: the video affective-response task in
// src/video-task now occupies this slot in the flow. Nothing imports this file.
// It is kept rather than deleted so the scenario task can be put back by
// pointing ClassificationTaskMain's first formOrder entry at "scenarios" again.
//
// This task replaces the earlier emotion-transition ("how likely is X to become Y")
// task. For each of three targets (yourself, your partner, an average UW-Madison
// student), the participant reads each situation and rates, on a 1-7 scale
// (1 = Not at all, 7 = Extremely), the degree to which that target would feel each
// listed emotion — plus a 1-7 confidence rating for each.
//
// Situations are written in the third person ("a person") so the same wording
// applies whether the target is the self, the partner, or an average student.
// Scenario order, target order, and emotion order within a scenario are all
// randomized at run time (see ScenarioRating / ClassificationTaskMain).
//
// WORDING NOTE (confirm with Randy): scenario `friend_moving` was completed from
// the detailed mockup ("...to start a new job"); the short list entry was
// truncated. All other wording is taken verbatim from the provided spec.

export interface Scenario {
  id: string;
  text: string;
  emotions: string[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: "stood_up_friend",
    text: "Imagine that a person makes plans to meet a friend for lunch. At five o'clock, they realize they have stood their friend up.",
    emotions: ["angry", "embarrassed", "sad"],
  },
  {
    id: "goal_achieved",
    text: "Imagine that after weeks of effort, a person's hard work pays off when they achieve an important personal goal.",
    emotions: ["content", "happy", "pride"],
  },
  {
    id: "life_going_well",
    text: "Imagine that a person reflects on their life and recognizes that things are going well across work, relationships, and personal goals.",
    emotions: ["content", "pride", "happy"],
  },
  {
    id: "credit_stolen",
    text: "Imagine that a person has worked hard on a group project, but someone else takes full credit and receives the praise.",
    emotions: ["sad", "annoyed", "angry"],
  },
  {
    id: "friend_moving",
    text: "Imagine that a person's best friend is moving across the country to start a new job.",
    emotions: ["happy", "anxious", "sad"],
  },
  {
    id: "bug_in_food",
    text: "Imagine that a person finds a bug crawling inside food they were just about to take a bite of.",
    emotions: ["angry", "disgust", "scared"],
  },
  {
    id: "new_city",
    text: "Imagine that a person is about to move to a new city where they have always wanted to live.",
    emotions: ["happy", "anxious", "excited"],
  },
  {
    id: "speech_celebration",
    text: "Imagine that a person is about to give a speech at a big celebration.",
    emotions: ["anxious", "excited", "scared"],
  },
];
