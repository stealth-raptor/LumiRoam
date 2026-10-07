import { Mastra } from "@mastra/core/mastra";
import { plannerAgent } from "./agents/planner";
import { guideAgent } from "./agents/guide";
import { planShootWorkflow } from "./workflows/plan-shoot";

export const mastra = new Mastra({
  agents: { plannerAgent, guideAgent },
  workflows: { planShootWorkflow },
});
