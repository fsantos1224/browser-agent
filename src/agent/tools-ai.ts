const NAVIGATE = {
  type: "function" as const,
  function: {
    name: "navigate",
    description: "Navigate the browser to a URL",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to navigate to" },
      },
      required: ["url"],
    },
  },
};

const CLICK = {
  type: "function" as const,
  function: {
    name: "click",
    description: "Click an element on the page",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the element to click" },
      },
      required: ["selector"],
    },
  },
};

const TYPE = {
  type: "function" as const,
  function: {
    name: "type",
    description: "Type text into an input field",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the input" },
        text: { type: "string", description: "Text to type" },
      },
      required: ["selector", "text"],
    },
  },
};

const SCROLL = {
  type: "function" as const,
  function: {
    name: "scroll",
    description: "Scroll the page or a specific element into view",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
        amount: { type: "string", description: "Pixels to scroll (default 300)" },
        selector: { type: "string", description: "Scroll to this element instead" },
      },
    },
  },
};

const EXTRACT = {
  type: "function" as const,
  function: {
    name: "extract",
    description: "Extract visible text from a specific element by CSS selector",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the element" },
      },
      required: ["selector"],
    },
  },
};

const GET_CONTENT = {
  type: "function" as const,
  function: {
    name: "getContent",
    description: "Get all visible text on the current page (no selector needed). Use this to read page content and find links, buttons, or text.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

const SCREENSHOT = {
  type: "function" as const,
  function: {
    name: "screenshot",
    description: "Take a screenshot of the current page",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export const TOOL_DONE = "done";

const DONE = {
  type: "function" as const,
  function: {
    name: TOOL_DONE,
    description: "Call this when the task is complete and you have the final result",
    parameters: {
      type: "object",
      properties: {
        result: { type: "string", description: "Summary of what was accomplished" },
      },
      required: ["result"],
    },
  },
};

export const toolDefinitions = [
  NAVIGATE,
  CLICK,
  TYPE,
  SCROLL,
  EXTRACT,
  GET_CONTENT,
  SCREENSHOT,
  DONE,
];
