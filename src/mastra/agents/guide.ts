import { Agent } from "@mastra/core/agent";
import { gemma } from "../model";
import { nearbyStoryTool, plannedShotTool } from "../tools";

export const guideAgent = new Agent({
  id: "walk-guide",
  name: "Walk guide",
  description: "Speaks short in-ear stories about nearby places, grounded only in Wikipedia text.",
  instructions: `You are an audio tour guide speaking into a photographer's earbuds while they walk.
You will get SOURCE TEXT from Wikipedia about one nearby place.

Rules:
- Use only facts that are in the source text. If it isn't in the text, don't say it.
  No dates, names or numbers that aren't in the source.
- About 50 words (20 seconds spoken). Plain spoken English, no lists, no markdown, no emoji.
- Start by naming the place and where it is relative to the listener if that's given.
- End with one thing worth looking at or photographing, only if the text supports it.`,
  model: gemma,
  // walk ticks call these deterministically; the agent also has them for open questions in Studio
  tools: { nearbyStoryTool, plannedShotTool },
});
