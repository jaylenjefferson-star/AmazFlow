import { createHash } from "node:crypto";
import {
  DynamoDBClient,
  ScanCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { AgentCoreMemory } from "./agentcore.js";

const tableName = required("TABLE_NAME");
const memoryId = required("AGENTCORE_MEMORY_ID");
const tenantId = process.env.DEFAULT_OPERATOR_TENANT_ID ?? "amazflow";
const db = new DynamoDBClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});
const memory = new AgentCoreMemory(memoryId);

type StoredMessage = { role?: string; content?: Array<{ text?: string }> };
type StoredConversation = { userId?: string; messages?: StoredMessage[] };

let cursor: Record<string, AttributeValue> | undefined;
let conversations = 0;
let events = 0;

do {
  const page = await db.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: "pk = :platform AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: {
        ":platform": { S: "PLATFORM" },
        ":prefix": { S: "COPILOTCONV#" },
      },
      ProjectionExpression: "sk, #document",
      ExpressionAttributeNames: { "#document": "document" },
      ExclusiveStartKey: cursor,
    }),
  );

  for (const item of page.Items ?? []) {
    if (!item.document?.S || !item.sk?.S) continue;
    const conversation = JSON.parse(item.document.S) as StoredConversation;
    const userId =
      conversation.userId ?? item.sk.S.slice("COPILOTCONV#".length);
    if (!userId) continue;
    conversations += 1;

    for (const [index, message] of (conversation.messages ?? []).entries()) {
      const text = scrub(
        (message.content ?? [])
          .map((block) => block.text ?? "")
          .join("\n")
          .trim(),
      );
      if (!text || (message.role !== "user" && message.role !== "assistant"))
        continue;
      await memory.remember({
        tenantId,
        actorId: userId,
        sessionId: `copilot-${userId}`,
        role: message.role === "user" ? "USER" : "ASSISTANT",
        text,
        // Historical conversation context remains short-term and is never extracted
        // into long-term memory. The token makes reruns safe and idempotent.
        clientToken: createHash("sha256")
          .update(`${tableName}:${item.sk.S}:${index}`)
          .digest("hex"),
      });
      events += 1;
    }
  }
  cursor = page.LastEvaluatedKey;
} while (cursor);

console.log(JSON.stringify({ conversations, events, tenantId }));

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function scrub(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(api[_-]?key|secret|password|token)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .slice(0, 20_000);
}
