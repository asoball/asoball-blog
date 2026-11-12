import { GoogleAuth } from "google-auth-library";
import type { ApiTransport } from "./firebase";

// Runtime identity / ADC only; never a stored service account JSON key.
export async function googleTransport(): Promise<ApiTransport> {
  const client = await new GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/firebase",
    ],
  }).getClient();
  return {
    request: async (options) => {
      try {
        return await client.request({
          ...options,
          timeout: 60000,
          retry: false,
          retryConfig: { retry: 0 },
          maxRedirects: 0,
        });
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response
          ?.status;
        // Gaxios errors contain request bodies and authorization headers; never log them.
        throw new Error(`Cloud API request failed (${status || "network"}).`);
      }
    },
  };
}
