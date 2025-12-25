#!/usr/bin/env node
// Trace the exact connection flow

import dgram from "node:dgram";

const PORT = 19876;

console.log("=== Connection Flow Tracer ===\n");

// Step 1: Listen for UDP packets
console.log("Step 1: Listening for UDP packets on port", PORT);

const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

socket.on("message", async (msg, rinfo) => {
  console.log(`\n--- UDP Packet from ${rinfo.address}:${rinfo.port} ---`);

  let data;
  try {
    data = JSON.parse(msg.toString());
  } catch (e) {
    console.log("  ERROR: Invalid JSON:", msg.toString().slice(0, 100));
    return;
  }

  console.log("  Type:", data.type);
  console.log("  instanceId:", data.instanceId);
  console.log("  serverUrl:", data.serverUrl);
  console.log("  project:", data.project);

  if (data.type !== "oc.announce") {
    console.log("  -> Not an announce packet, skipping");
    return;
  }

  if (!data.serverUrl) {
    console.log("  -> ERROR: No serverUrl in packet!");
    return;
  }

  // Step 2: Try to connect via SDK
  console.log("\nStep 2: Testing SDK connection to", data.serverUrl);

  try {
    const { createOpencodeClient } = await import("@opencode-ai/sdk");
    const client = createOpencodeClient({ baseUrl: data.serverUrl });

    console.log("  SDK client created");

    // Step 3: Fetch sessions
    console.log("\nStep 3: Fetching sessions...");
    const listResp = await client.session.list();
    console.log("  Got", listResp.data?.length || 0, "sessions");

    // Step 4: Fetch status
    console.log("\nStep 4: Fetching status...");
    const statusResp = await client.session.status();
    console.log("  Status:", JSON.stringify(statusResp.data));

    // Step 5: Test SSE
    console.log("\nStep 5: Testing SSE subscription...");
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 2000);

    const sseResp = await client.event.subscribe({
      signal: abortController.signal,
    });
    console.log("  SSE response has .stream:", !!sseResp.stream);

    let eventCount = 0;
    try {
      for await (const event of sseResp.stream) {
        eventCount++;
        console.log(`  Event ${eventCount}: ${event.type}`);
        if (eventCount >= 3) {
          abortController.abort();
          break;
        }
      }
    } catch (e) {
      if (e.name === "AbortError") {
        console.log("  SSE aborted after", eventCount, "events");
      } else {
        throw e;
      }
    }

    console.log("\n=== SUCCESS: All steps passed ===");
    socket.close();
    process.exit(0);
  } catch (err) {
    console.log("\n  ERROR:", err.message);
    console.log("  Stack:", err.stack?.split("\n").slice(0, 5).join("\n    "));
  }
});

socket.on("error", (err) => {
  console.error("Socket error:", err.message);
  process.exit(1);
});

socket.bind(PORT, () => {
  console.log("Listening... (waiting for oc.announce packet)");
  console.log("Press Ctrl+C to exit\n");
});

// Timeout after 30 seconds
setTimeout(() => {
  console.log("\nTimeout: No packets received in 30 seconds");
  socket.close();
  process.exit(1);
}, 30000);
