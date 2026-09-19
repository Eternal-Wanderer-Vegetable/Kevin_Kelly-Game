// Example heritable plugin: registers a "word-count" tool the agent can call.
export const tools = {
  "word-count": async (input) => {
    const text = typeof input.text === "string" ? input.text : "";
    const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
    return { ok: true, output: { words } };
  },
};
