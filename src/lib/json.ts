export function safeParseJson<T>(text: string, fallback: T, context?: string): T {
  if (!text || text.trim().length === 0) {
    return fallback;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    if (context) {
      console.error(`Failed to parse JSON for ${context}`, error);
    } else {
      console.error('Failed to parse JSON payload', error);
    }
    return fallback;
  }
}
