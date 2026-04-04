// Polymarket WebSocket real-time data
export class PolymarketWS {
  private ws: WebSocket | null = null;
  connect(onMessage: (data: unknown) => void) {
    void onMessage;
    // TODO: connect to wss://ws-live-data.polymarket.com
  }
  disconnect() {
    this.ws?.close();
    this.ws = null;
  }
}
