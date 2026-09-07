import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { AiProvider } from "@amazflow/engine";
import type { WorkflowStep } from "@amazflow/workflow-schema";

export class BedrockAiProvider implements AiProvider {
  private client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  constructor(private modelId: string) {}

  async run(step: Extract<WorkflowStep,{type:"ai"}>, context: Record<string, unknown>) {
    const allowed = step.allowedValues?.length ? `Allowed values: ${step.allowedValues.join(", ")}.` : "Return the requested structured value.";
    const response = await this.client.send(new ConverseCommand({
      modelId: this.modelId,
      system: [{ text: "You are a bounded operations workflow component. Never choose or invent tools. Return JSON only with keys value and confidence." }],
      messages: [{ role: "user", content: [{ text: `${step.prompt}\nOperation: ${step.operation}. ${allowed}\nContext:\n${JSON.stringify(context)}` }] }],
      inferenceConfig: { maxTokens: 800, temperature: 0 }
    }));
    const text = response.output?.message?.content?.find(part => "text" in part)?.text;
    if (!text) throw new Error("Bedrock returned no structured output");
    const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g,"")) as {value:unknown;confidence:number};
    if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1) throw new Error("Invalid AI confidence");
    if (step.allowedValues && !step.allowedValues.includes(String(parsed.value))) throw new Error("AI returned a value outside the allowlist");
    return { ...parsed, raw: { modelId: this.modelId } };
  }
}
