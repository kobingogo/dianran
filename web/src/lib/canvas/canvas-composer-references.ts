export const canvasReferenceIds = (prompt: string) => [...new Set([...prompt.matchAll(/@\[node:([^\]]+)\]/g)].map((match) => match[1]))];
