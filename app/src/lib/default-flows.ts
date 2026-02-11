import type { FlowDefinition } from "./flow-types";

/**
 * Default "General Coding Assistant" flow.
 * Start -> Intent -> Router -> LLM (Opus/Sonnet/Haiku) -> Evaluator -> End
 */
export const GENERAL_CODING_ASSISTANT: FlowDefinition = {
  id: "default-general-coding-assistant",
  name: "General Coding Assistant",
  description: "Routes user requests by complexity to the appropriate model, with quality evaluation.",
  nodes: [
    {
      id: "start_1",
      kind: "start",
      label: "User Input",
      x: 400,
      y: 30,
      config: { kind: "start", config: {} },
    },
    {
      id: "intent_1",
      kind: "intent",
      label: "Classify Intent",
      x: 370,
      y: 140,
      config: {
        kind: "intent",
        config: {
          classifications: [
            { name: "feature", instructions: "User wants a new feature or capability added" },
            { name: "bug-fix", instructions: "User is reporting a bug or error to fix" },
            { name: "question", instructions: "User is asking a question about the codebase" },
            { name: "refactor", instructions: "User wants existing code restructured" },
            { name: "docs", instructions: "User wants documentation written or updated" },
          ],
        },
      },
    },
    {
      id: "router_1",
      kind: "router",
      label: "Complexity Router",
      x: 370,
      y: 260,
      config: {
        kind: "router",
        config: {
          mode: "llm",
          rules: [
            { condition: "high complexity", output: "opus" },
            { condition: "medium complexity", output: "sonnet" },
            { condition: "low complexity", output: "haiku" },
          ],
        },
      },
    },
    {
      id: "llm_opus",
      kind: "llm",
      label: "Opus Agent",
      x: 120,
      y: 400,
      config: {
        kind: "llm",
        config: {
          model: "opus",
          systemPrompt: "You are an expert software architect. Handle complex tasks like new features, architecture decisions, and multi-file refactors.",
          temperature: 0.7,
          maxTokens: 8192,
          tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
          enableThinking: true,
          toolPreset: "full-access",
        },
      },
    },
    {
      id: "llm_sonnet",
      kind: "llm",
      label: "Sonnet Agent",
      x: 370,
      y: 400,
      config: {
        kind: "llm",
        config: {
          model: "sonnet",
          systemPrompt: "You are a skilled software developer. Handle moderate tasks like bug fixes, feature additions, and code reviews.",
          temperature: 0.7,
          maxTokens: 4096,
          tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
          enableThinking: true,
          toolPreset: "full-access",
        },
      },
    },
    {
      id: "llm_haiku",
      kind: "llm",
      label: "Haiku Agent",
      x: 620,
      y: 400,
      config: {
        kind: "llm",
        config: {
          model: "haiku",
          systemPrompt: "You are a fast coding assistant. Handle simple tasks like logging, comments, small fixes, and quick questions.",
          temperature: 0.5,
          maxTokens: 2048,
          tools: ["Read", "Glob", "Grep"],
          enableThinking: false,
          toolPreset: "read-only",
        },
      },
    },
    {
      id: "tool_tests",
      kind: "tool",
      label: "Run Tests",
      x: 250,
      y: 540,
      config: {
        kind: "tool",
        config: {
          toolName: "run-tests",
          args: {},
        },
      },
    },
    {
      id: "evaluator_1",
      kind: "evaluator",
      label: "Quality Check",
      x: 370,
      y: 660,
      config: {
        kind: "evaluator",
        config: {
          criteria: "Evaluate the code quality, correctness, and completeness of the output. Check that tests pass and the implementation matches the user's request.",
          passThreshold: 75,
        },
      },
    },
    {
      id: "end_1",
      kind: "end",
      label: "Deliver Result",
      x: 400,
      y: 780,
      config: { kind: "end", config: {} },
    },
  ],
  edges: [
    { id: "e_start_intent", source: "start_1", target: "intent_1", sourceHandle: "default", targetHandle: null, signal: "default" },
    { id: "e_intent_router", source: "intent_1", target: "router_1", sourceHandle: "default", targetHandle: null, signal: "default" },
    { id: "e_router_opus", source: "router_1", target: "llm_opus", sourceHandle: "default", targetHandle: null, signal: "default" },
    { id: "e_router_sonnet", source: "router_1", target: "llm_sonnet", sourceHandle: "default", targetHandle: null, signal: "default" },
    { id: "e_router_haiku", source: "router_1", target: "llm_haiku", sourceHandle: "default", targetHandle: null, signal: "default" },
    { id: "e_opus_tests", source: "llm_opus", target: "tool_tests", sourceHandle: "default", targetHandle: null, signal: "success" },
    { id: "e_sonnet_tests", source: "llm_sonnet", target: "tool_tests", sourceHandle: "default", targetHandle: null, signal: "success" },
    { id: "e_haiku_eval", source: "llm_haiku", target: "evaluator_1", sourceHandle: "default", targetHandle: null, signal: "success" },
    { id: "e_tests_eval", source: "tool_tests", target: "evaluator_1", sourceHandle: "default", targetHandle: null, signal: "success" },
    { id: "e_eval_end", source: "evaluator_1", target: "end_1", sourceHandle: "success", targetHandle: null, signal: "success" },
  ],
  createdAt: 1707600000000,
  updatedAt: 1707600000000,
};
