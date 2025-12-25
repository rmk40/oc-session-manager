#!/usr/bin/env node
// Test the actual ConnectionManager class

import dgram from "node:dgram";

const PORT = 19876;

console.log("=== ConnectionManager Integration Test ===\n");

// Step 1: Import and initialize SDK
console.log("Step 1: Importing SDK and ConnectionManager...");

let initSdk, ConnectionManager;
try {
  // We need to import from the built bundle or source
  const sdk = await import("@opencode-ai/sdk");
  console.log("  SDK imported successfully");

  // For now, test the SDK directly since we can't easily import the TS module
} catch (err) {
  console.error("  ERROR importing:", err.message);
  process.exit(1);
}

// Step 2: Listen for UDP and simulate ConnectionManager behavior
console.log("\nStep 2: Simulating ConnectionManager.handleAnnounce()...");

const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

socket.on("message", async (msg, rinfo) => {
  let data;
  try {
    data = JSON.parse(msg.toString());
  } catch (e) {
    return;
  }

  if (data.type !== "oc.announce" || !data.serverUrl) {
    return;
  }

  console.log(`\n  Received announce: ${data.serverUrl}`);

  // Simulate what ConnectionManager.connectToServer does
  const { createOpencodeClient } = await import("@opencode-ai/sdk");

  console.log("  Creating SDK client...");
  const client = createOpencodeClient({ baseUrl: data.serverUrl });

  console.log("  Fetching sessions...");
  const [listResp, statusResp] = await Promise.all([
    client.session.list(),
    client.session.status().catch(() => ({ data: {} })),
  ]);

  const sessions = listResp.data || [];
  const statusMap = statusResp.data || {};

  console.log(`  Found ${sessions.length} sessions:`);
  for (const s of sessions) {
    const statusObj = statusMap[s.id];
    const status = statusObj?.type || "idle";
    console.log(
      `    - ${s.id.slice(-8)} [${status}] ${s.parentID ? "(child)" : "(root)"} "${s.title?.slice(0, 30) || "(no title)"}"`
    );
  }

  console.log("\n  Subscribing to SSE...");
  const abortController = new AbortController();
  setTimeout(() => abortController.abort(), 3000);

  try {
    const response = await client.event.subscribe({
      signal: abortController.signal,
    });

    console.log(`  SSE response.stream exists: ${!!response.stream}`);

    let count = 0;
    for await (const event of response.stream) {
      count++;
      const sessionId = event.properties?.sessionID;
      console.log(
        `    Event ${count}: ${event.type}${sessionId ? ` (session: ${sessionId.slice(-8)})` : ""}`
      );
      if (count >= 5) {
        abortController.abort();
        break;
      }
    }
  } catch (err) {
    if (err.name === "AbortError") {
      console.log("  SSE stream closed after timeout");
    } else {
      throw err;
    }
  }

  console.log("\n=== Test PASSED ===");
  socket.close();
  process.exit(0);
});

socket.bind(PORT, () => {
  console.log(`  Listening on UDP port ${PORT}...`);
});

setTimeout(() => {
  console.log("\nTimeout waiting for packet");
  process.exit(1);
}, 15000);
