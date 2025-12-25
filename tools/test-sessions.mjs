#!/usr/bin/env node
// Test script to monitor active sessions via SSE
//
// Usage: node tools/test-sessions.mjs [port]
// Example: node tools/test-sessions.mjs 55368

const port = process.argv[2] || '4096';
const baseUrl = `http://127.0.0.1:${port}`;

console.log(`Connecting to ${baseUrl}...`);

// Track active sessions from SSE events
const sessions = new Map(); // sessionID -> { status, title, parentID }

async function fetchSessionDetails(sessionId) {
  try {
    const resp = await fetch(`${baseUrl}/session/${sessionId}`);
    if (resp.ok) {
      return await resp.json();
    }
  } catch {
    // ignore
  }
  return null;
}

function displaySessions() {
  console.clear();
  console.log(`=== Active Sessions on ${baseUrl} ===`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('');

  // Separate parents and children
  const parents = [];
  const children = new Map(); // parentID -> [children]

  for (const [id, session] of sessions) {
    if (session.parentID) {
      if (!children.has(session.parentID)) {
        children.set(session.parentID, []);
      }
      children.get(session.parentID).push({ id, ...session });
    } else {
      parents.push({ id, ...session });
    }
  }

  if (parents.length === 0 && sessions.size === 0) {
    console.log('No active sessions');
    return;
  }

  // Display hierarchy
  for (const parent of parents) {
    const statusIcon = parent.status === 'busy' ? '🔴' : '⚪';
    console.log(`${statusIcon} ${parent.id.slice(-8)} [${parent.status}] ${parent.title || '(no title)'}`);

    const kids = children.get(parent.id) || [];
    for (const child of kids) {
      const childIcon = child.status === 'busy' ? '🔴' : '⚪';
      console.log(`  └─ ${childIcon} ${child.id.slice(-8)} [${child.status}] ${child.title || '(no title)'}`);
    }
  }

  // Show orphaned children (parent not in active set)
  for (const [parentID, kids] of children) {
    if (!parents.find(p => p.id === parentID)) {
      console.log(`(parent ${parentID.slice(-8)} not active)`);
      for (const child of kids) {
        const childIcon = child.status === 'busy' ? '🔴' : '⚪';
        console.log(`  └─ ${childIcon} ${child.id.slice(-8)} [${child.status}] ${child.title || '(no title)'}`);
      }
    }
  }

  console.log('');
  console.log(`Total active: ${sessions.size}`);
}

async function handleEvent(event) {
  const { type, properties } = event;

  if (type === 'session.status') {
    const { sessionID, status } = properties;
    
    if (status.type === 'idle') {
      // Remove from active sessions
      sessions.delete(sessionID);
    } else {
      // Add or update
      const existing = sessions.get(sessionID);
      if (existing) {
        existing.status = status.type;
      } else {
        // Fetch details
        const details = await fetchSessionDetails(sessionID);
        sessions.set(sessionID, {
          status: status.type,
          title: details?.title,
          parentID: details?.parentID,
        });
      }
    }
  } else if (type === 'session.updated') {
    const { info } = properties;
    const existing = sessions.get(info.id);
    if (existing) {
      existing.title = info.title;
      existing.parentID = info.parentID;
    }
  }
}

async function connect() {
  try {
    const response = await fetch(`${baseUrl}/event`, {
      headers: { 'Accept': 'text/event-stream' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    console.log('Connected to SSE stream');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            await handleEvent(event);
          } catch {
            // ignore parse errors
          }
        }
      }
    }
  } catch (err) {
    console.error('Connection error:', err.message);
    console.log('Reconnecting in 2 seconds...');
    setTimeout(connect, 2000);
  }
}

// Display update interval
setInterval(displaySessions, 1000);

// Initial display
displaySessions();

// Start SSE connection
connect();

// Handle exit
process.on('SIGINT', () => {
  console.log('\nExiting...');
  process.exit(0);
});
