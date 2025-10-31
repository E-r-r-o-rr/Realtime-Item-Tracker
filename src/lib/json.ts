// Defensive JSON parsing helper for API responses where partial failures should not crash
// the UI. Returns a caller-supplied fallback when parsing fails.
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

// Reads and parses a JSON request body while providing structured logging on failure.
export async function readJsonBody<T>(request: Request, fallback: T, context?: string): Promise<T> {
  try {
    const raw = await request.text();
    if (!raw || raw.trim().length === 0) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch (error) {
    if (context) {
      console.error(`Failed to parse request JSON for ${context}`, error);
    } else {
      console.error('Failed to parse request JSON payload', error);
    }
    return fallback;
  }
}
