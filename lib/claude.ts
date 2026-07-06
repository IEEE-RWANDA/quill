import Anthropic from "@anthropic-ai/sdk";
import { registrySummary } from "./sites.js";

// Haiku 4.5: fast and cheap (~1.5 cents per edit). Plenty for parsing a request
// and rewriting a small JSON file. Bump to "claude-sonnet-5" if you want more
// reasoning on complex edits.
const MODEL = "claude-haiku-4-5";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// --- Step 1: route the request to a site + content file -------------------

export interface Route {
  understood: boolean;
  siteKey: string;
  fileKey: string;
  clarification: string;
}

const ROUTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    understood: {
      type: "boolean",
      description: "True if you are confident which site and file to edit.",
    },
    siteKey: { type: "string", description: "The chosen siteKey, or empty." },
    fileKey: { type: "string", description: "The chosen fileKey, or empty." },
    clarification: {
      type: "string",
      description:
        "If understood is false, a short question asking the user what to clarify. Otherwise empty.",
    },
  },
  required: ["understood", "siteKey", "fileKey", "clarification"],
};

export async function route(message: string): Promise<Route> {
  const res = (await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system:
      "You route a content-edit request to exactly one site and one content file from a registry. " +
      "Match on the site name and the file descriptions. If nothing clearly matches, set understood=false " +
      "and ask a brief clarifying question. Only pick siteKey/fileKey values that exist in the registry.",
    messages: [
      {
        role: "user",
        content:
          `Registry:\n${JSON.stringify(registrySummary(), null, 2)}\n\n` +
          `Request:\n${message}`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: ROUTE_SCHEMA } },
  } as any)) as Anthropic.Message;

  return JSON.parse(textOf(res)) as Route;
}

// --- Step 2: rewrite the file --------------------------------------------

export interface Edit {
  newContent: string;
  summary: string;
  changedSection: string;
}

const EDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    newContent: {
      type: "string",
      description: "The COMPLETE updated file content, ready to commit verbatim.",
    },
    summary: {
      type: "string",
      description: "One short sentence describing the change (used as the commit/PR title).",
    },
    changedSection: {
      type: "string",
      description:
        "Just the part that was added or changed (e.g. the new JSON object), for a quick preview in chat.",
    },
  },
  required: ["newContent", "summary", "changedSection"],
};

export async function rewrite(params: {
  instruction: string;
  path: string;
  currentContent: string;
}): Promise<Edit> {
  const { instruction, path, currentContent } = params;
  const res = (await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system:
      "You edit a single content file for a website. You are given the file's current content and an " +
      "instruction. Apply the instruction and return the COMPLETE new file content, preserving the existing " +
      "formatting, indentation, and structure. Change only what the instruction asks for. If the file is JSON, " +
      "keep it valid JSON. Do not add commentary inside the file.",
    messages: [
      {
        role: "user",
        content:
          `File path: ${path}\n\n` +
          `Current content:\n\`\`\`\n${currentContent}\n\`\`\`\n\n` +
          `Instruction:\n${instruction}`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: EDIT_SCHEMA } },
  } as any)) as Anthropic.Message;

  return JSON.parse(textOf(res)) as Edit;
}
