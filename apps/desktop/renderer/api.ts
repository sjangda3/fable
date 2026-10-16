import {
  FableError,
  type FableAPI,
  type Operation,
  type Operations,
} from "../../../packages/contracts/index.ts";
declare global {
  interface Window {
    fable?: FableAPI;
  }
}
let stream: EventSource | undefined;
const listeners = new Set<(e: any) => void>();
export const api: FableAPI = window.fable ?? {
  platform: navigator.platform.toLowerCase().includes("mac") ? "darwin" : "web",
  async request<K extends Operation>(
    operation: K,
    args: Operations[K]["input"],
  ): Promise<Operations[K]["output"]> {
    let response: Response;
    try {
      response = await fetch("/api/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Fable-Request": "1" },
        body: JSON.stringify({ operation, args }),
      });
    } catch {
      throw new FableError(
        "FILESYSTEM",
        "Cannot reach Fable’s local file service. Restart the development preview, then check your changes before retrying.",
      );
    }
    const data = await response.json();
    if (data.error) {
      const error = new Error(data.error);
      Object.assign(error, { code: data.code });
      throw error;
    }
    if (data.state)
      listeners.forEach((listener) =>
        listener({ type: "vault", state: data.state }),
      );
    return data.result;
  },
  subscribe(listener) {
    listeners.add(listener);
    if (!stream) {
      stream = new EventSource("/api/events");
      stream.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          listeners.forEach((l) => l(data));
        } catch {}
      };
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        stream?.close();
        stream = undefined;
      }
    };
  },
};
