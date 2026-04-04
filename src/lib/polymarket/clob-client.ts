// CLOB API client (Polymarket order book)
export class ClobClient {
  private apiKey: string;
  constructor(apiKey: string) { this.apiKey = apiKey; }
  async getOrderBook(conditionId: string) {
    // TODO: implement with L2 auth
    void conditionId;
    return null;
  }
}
