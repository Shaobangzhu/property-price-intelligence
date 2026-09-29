export const CAPS = { property: 1, recordedSales: 1, activeListings: 1, categories: 1, places: 1, openai: 1 } as const;
export type Operation = keyof typeof CAPS;
export class RequestBudget {
  private counts: Record<Operation, number> = { property: 0, recordedSales: 0, activeListings: 0, categories: 0, places: 0, openai: 0 };
  private total = 0;
  async attempt<T>(operation: Operation, execute: () => Promise<T>): Promise<T> {
    if (this.counts[operation] >= CAPS[operation] || this.total >= 6) throw new Error('Request budget exhausted');
    this.counts[operation]++; this.total++;
    return execute();
  }
  snapshot() { return { ...this.counts, total: this.total }; }
}
