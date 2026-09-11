/** Keep bounded completion budgets available for final text on DeepSeek. */
export function boundedCompletionOptions(baseUrl: string): { thinking?: { type: 'disabled' } } {
  try {
    if (new URL(baseUrl).origin === 'https://api.deepseek.com') {
      return { thinking: { type: 'disabled' } };
    }
  } catch { /* Invalid endpoints retain the normal provider failure path. */ }
  return {};
}
