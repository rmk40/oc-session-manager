#!/usr/bin/env node
// Test script for ConnectionManager

import { createOpencodeClient } from "@opencode-ai/sdk";

async function main() {
  console.log("Testing SDK connection to http://localhost:4096...\n");

  const client = createOpencodeClient({ baseUrl: "http://localhost:4096" });

  // Test 1: Session list
  console.log("1. Testing session.list()...");
  try {
    const listResp = await client.session.list();
    console.log("   Sessions:", listResp.data?.length || 0);
    for (const s of listResp.data || []) {
      console.log(
        `   - ${s.id.slice(-8)} ${s.parentID ? "(child)" : "(root)"} "${s.title?.slice(0, 40) || "(no title)"}"`
      );
    }
  } catch (err) {
    console.error("   Error:", err.message);
  }

  // Test 2: Session status
  console.log("\n2. Testing session.status()...");
  try {
    const statusResp = await client.session.status();
    console.log("   Status map:", JSON.stringify(statusResp.data, null, 2));
  } catch (err) {
    console.error("   Error:", err.message);
  }

  // Test 3: SSE subscription
  console.log("\n3. Testing event.subscribe() SSE...");
  const abortController = new AbortController();

  // Abort after 3 seconds
  setTimeout(() => {
    console.log("\n   Aborting SSE after 3 seconds...");
    abortController.abort();
  }, 3000);

  try {
    const response = await client.event.subscribe({
      signal: abortController.signal,
    });

    console.log("   Response has stream:", !!response.stream);
    console.log(
      "   Stream is async iterable:",
      typeof response.stream?.[Symbol.asyncIterator] === "function"
    );

    if (response.stream) {
      let count = 0;
      for await (const event of response.stream) {
        console.log(`   Event ${++count}:`, event.type);
        if (count >= 5) {
          abortController.abort();
          break;
        }
      }
      console.log(`   Received ${count} events`);
    }
  } catch (err) {
    if (err.name === "AbortError") {
      console.log("   SSE aborted cleanly");
    } else {
      console.error("   Error:", err.message);
    }
  }

  console.log("\nAll tests complete!");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
