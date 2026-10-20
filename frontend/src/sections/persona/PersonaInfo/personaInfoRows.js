import _ from "lodash";
import { AGENT_TYPES } from "src/sections/agents/constants";

/*
  What the persona drawer says about a persona, as rows of [label, value].
  Every value is said in words: a speed is "0.75× — slower than usual", a
  sensitivity is "4 of 10" with which way it leans — a bare 4 or 0.75 tells
  nobody anything. A row with nothing set is left out; a section with no rows
  says "Not set".
*/

const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]).filter((x) => x !== "" && x != null);
const words = (v) => list(v).map((x) => _.upperFirst(String(x).replace(/_/g, " "))).join(", ");

/* The ends of each 1–10 slider, as the create form describes them. */
const SCALES = {
  finished: { low: "waits for longer pauses", high: "jumps in after short pauses" },
  interrupt: { low: "keeps talking when interrupted", high: "stops as soon as interrupted" },
};

const onScale = (value, scale) => {
  const n = Number(list(value)[0]);
  if (!Number.isFinite(n)) return null;
  const lean = n <= 4 ? `${scale.low}` : n >= 7 ? `${scale.high}` : "in between";
  return `${n} of 10 — ${lean}`;
};

const speedLine = (value) => {
  const n = Number(list(value)[0]);
  if (!Number.isFinite(n)) return null;
  const how = n < 1 ? "slower than usual" : n > 1 ? "faster than usual" : "usual pace";
  return `${n}× — ${how}`;
};

export const isVoicePersona = (p) => p?.simulationType !== AGENT_TYPES.CHAT;

export const whoRowsOf = (p) => [
  ["Gender", list(p?.gender).map(_.capitalize).join(", ")],
  ["Age", list(p?.ageGroup).join(", ")],
  ["Location", list(p?.location).join(", ")],
  ["Occupation", words(p?.occupation ?? p?.profession)],
].filter(([, v]) => v);

export const talkRowsOf = (p) => [
  ["Personality", words(p?.personality)],
  ["Communication style", words(p?.communicationStyle)],
  ...(isVoicePersona(p) ? [["Accent", words(p?.accent)]] : []),
  ["Languages", list(p?.languages).join(", ")],
  ...(p?.multilingual != null ? [["Switches language", p.multilingual === false ? "No" : "Yes"]] : []),
].filter(([, v]) => v);

export const callRowsOf = (p) => [
  ["Speaking speed", speedLine(p?.conversationSpeed)],
  ...(p?.backgroundSound != null ? [["Background noise", p.backgroundSound === false || p.backgroundSound === "false" ? "None" : "On the line"]] : []),
  ["Finished-speaking sensitivity", onScale(p?.finishedSpeakingSensitivity, SCALES.finished)],
  ["Interrupt sensitivity", onScale(p?.interruptSensitivity, SCALES.interrupt)],
].filter(([, v]) => v);

export const chatRowsOf = (p) => [
  ["Tone", words(p?.tone)],
  ["Message length", words(p?.verbosity)],
  ["Punctuation", words(p?.punctuation)],
  ["Slang", words(p?.slangUsage)],
  ["Typos", words(p?.typosFrequency)],
  ["Regional mix", words(p?.regionalMix)],
  ["Emoji", words(p?.emojiUsage)],
].filter(([, v]) => v);

/* "12 scenarios in 2 environments" · "Not used yet". */
export const usageLineOf = (u) => (u?.scenarios
  ? `${u.scenarios} scenario${u.scenarios === 1 ? "" : "s"} in ${u.envs.length} environment${u.envs.length === 1 ? "" : "s"}`
  : "Not used yet");
