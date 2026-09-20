import { useState } from "react";
import QuestionnairePage from "../components/QuestionnairePage";
import type { ClassificationTaskProps } from "./types";

const RACE_OPTIONS = [
  "White",
  "Asian",
  "Black or African American",
  "Native Hawaiian or Pacific Islander",
  "American Indian or Alaska Native",
  "Other",
];

export default function Demographics({ onContinue }: ClassificationTaskProps) {
  const [age, setAge] = useState<string>("");
  const [hispanicLatino, setHispanicLatino] = useState<string>("");
  const [races, setRaces] = useState<string[]>([]);
  const [otherRace, setOtherRace] = useState<string>("");
  const [sex, setSex] = useState<string>("");
  const [zipCode, setZipCode] = useState<string>("");
  const [attempted, setAttempted] = useState(false);

  const handleRaceChange = (race: string) => {
    setRaces((prev) =>
      prev.includes(race) ? prev.filter((r) => r !== race) : [...prev, race]
    );
  };

  const isFormValid =
    age.trim() !== "" &&
    hispanicLatino !== "" &&
    races.length > 0 &&
    (!races.includes("Other") || otherRace.trim() !== "") &&
    sex !== "" &&
    zipCode.trim() !== "";

  const AGE_Q = "Enter your age:";
  const HISPANIC_Q = "Are you Spanish, Hispanic, or Latino?";
  const RACE_Q = "Choose one or more races that you consider yourself to be:";
  const OTHER_RACE_Q = "Please specify (other race):";
  const SEX_Q = "What is your sex?";
  const ZIP_Q =
    "Please provide the zip code of your permanent address (where you grew up):";

  const blanks: Record<string, boolean> = {
    [AGE_Q]: age.trim() === "",
    [HISPANIC_Q]: hispanicLatino === "",
    [RACE_Q]: races.length === 0,
    [OTHER_RACE_Q]: races.includes("Other") && otherRace.trim() === "",
    [SEX_Q]: sex === "",
    [ZIP_Q]: zipCode.trim() === "",
  };
  const missing = Object.keys(blanks).filter((q) => blanks[q]);
  const mark = (question: string) =>
    attempted && blanks[question] ? (
      <span className="text-red-400 font-bold mr-1">*</span>
    ) : null;

  const inputClass =
    "w-full p-3 text-white bg-gray-800 border border-white rounded-lg focus:outline-none focus:border-blue-400";
  const btnClass = (active: boolean) =>
    `flex-1 px-4 py-3 border border-white rounded-lg transition-colors ${
      active ? "bg-white text-black" : "bg-gray-800 hover:bg-gray-700 text-white"
    }`;

  return (
    <QuestionnairePage
      valid={isFormValid}
      missing={missing}
      onIncomplete={() => setAttempted(true)}
      onSubmit={() => onContinue?.({ age, hispanicLatino, races, otherRace, sex, zipCode })}
    >
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <label className="block text-white text-lg mb-2 text-left">{mark(AGE_Q)}{AGE_Q}</label>
          <input
            type="text"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            className={inputClass}
            placeholder="Enter your age"
          />
        </div>

        <div>
          <label className="block text-white text-lg mb-2 text-left">
            {mark(HISPANIC_Q)}
            {HISPANIC_Q}
          </label>
          <div className="flex space-x-4">
            <button type="button" onClick={() => setHispanicLatino("yes")} className={btnClass(hispanicLatino === "yes")}>Yes</button>
            <button type="button" onClick={() => setHispanicLatino("none")} className={btnClass(hispanicLatino === "none")}>None of these</button>
          </div>
        </div>

        <div>
          <label className="block text-white text-lg mb-2 text-left">
            {mark(RACE_Q)}
            {RACE_Q}
          </label>
          <div className="space-y-3">
            {RACE_OPTIONS.map((race) => (
              <label key={race} className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={races.includes(race)}
                  onChange={() => handleRaceChange(race)}
                  className="w-5 h-5 text-blue-600 bg-gray-800 border-white rounded focus:ring-blue-500 focus:ring-2"
                />
                <span className="text-white text-lg">{race}</span>
              </label>
            ))}
          </div>
          {races.includes("Other") && (
            <div className="mt-4">
              <input
                type="text"
                value={otherRace}
                onChange={(e) => setOtherRace(e.target.value)}
                className={inputClass}
                placeholder="Please specify"
              />
            </div>
          )}
        </div>

        <div>
          <label className="block text-white text-lg mb-2 text-left">{mark(SEX_Q)}{SEX_Q}</label>
          <div className="flex space-x-4">
            <button type="button" onClick={() => setSex("male")} className={btnClass(sex === "male")}>Male</button>
            <button type="button" onClick={() => setSex("female")} className={btnClass(sex === "female")}>Female</button>
          </div>
        </div>

        <div>
          <label className="block text-white text-lg mb-2 text-left">
            {mark(ZIP_Q)}
            {ZIP_Q}
          </label>
          <input
            type="text"
            value={zipCode}
            onChange={(e) => setZipCode(e.target.value)}
            className={inputClass}
            placeholder="Enter zip code"
          />
        </div>
      </div>
    </QuestionnairePage>
  );
}
