// In-process Server-Sent Events hub. Each signed-in browser tab keeps one
// EventSource open; the server pushes notifications to a specific user and
// availability changes to everyone so open schedules refresh live.
const clients = new Map(); // userId -> Set<ServerResponse>

export function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
}

export function removeClient(userId, res) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(res);
  if (!set.size) clients.delete(userId);
}

function write(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Connection is closing; the 'close' handler will clean it up.
  }
}

export function sendToUser(userId, event, data) {
  for (const res of clients.get(userId) || []) write(res, event, data);
}

export function broadcast(event, data) {
  for (const set of clients.values()) for (const res of set) write(res, event, data);
}

export function connectionCount() {
  let n = 0;
  for (const set of clients.values()) n += set.size;
  return n;
}

// Keep proxies from closing idle streams.
const heartbeat = setInterval(() => {
  for (const set of clients.values()) {
    for (const res of set) {
      try {
        res.write(': ping\n\n');
      } catch {
        // ignore
      }
    }
  }
}, 25_000);
heartbeat.unref();
