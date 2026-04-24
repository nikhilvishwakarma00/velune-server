const http = require('http');
const WebSocket = require('ws');

// In-memory database to store active sessions
const activeSessions = {};

const server = http.createServer((req, res) => {
    // Add CORS headers so Android doesn't block it
    res.setHeader('Content-Type', 'application/json');

    // 1. Health Check
    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: "Velune Server is online!" }));
        return;
    }

    // Helper to read JSON body
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
        let parsedBody = {};
        if (body) {
            try { parsedBody = JSON.parse(body); } catch (e) {}
        }

        // 2. GUEST ROUTE: Resolve the 6-digit code
        // IMPORTANT: Check 'resolve' BEFORE the create route to avoid collision!
        if (req.method === 'POST' && req.url.includes('/v1/together/sessions/resolve')) {
            const requestedCode = parsedBody.code;
            
            // Look up the code in our database
            const sessionCodeKey = Object.keys(activeSessions).find(k => activeSessions[k].code === requestedCode);
            const session = activeSessions[sessionCodeKey];

            if (session) {
                // Success! Send the exact JSON 'TogetherOnlineResolveResponse' expects
                res.writeHead(200);
                res.end(JSON.stringify({
                    sessionId: session.sessionId,
                    guestKey: session.guestKey,
                    wsUrl: session.wsUrl,
                    settings: session.settings
                }));
            } else {
                res.writeHead(404);
                res.end(JSON.stringify({ error: "Session not found" }));
            }
            return;
        }

        // 3. HOST ROUTE: Create a new session
        if (req.method === 'POST' && req.url.includes('/v1/together/sessions')) {
            const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
            
            // Extract settings from the Host's request
            const roomSettings = parsedBody.settings || {
                allowGuestsToAddTracks: true,
                allowGuestsToControlPlayback: false,
                requireHostApprovalToJoin: false
            };

            // Save the room to our database
            activeSessions[randomCode] = {
                sessionId: "sess-" + randomCode,
                code: randomCode,
                hostKey: "host-key-" + Date.now(),
                guestKey: "guest-key-" + Date.now(),
                wsUrl: "wss://" + req.headers.host + "/v1/together/ws",
                settings: roomSettings,
                clients: new Set(),
                currentState: { // The empty state Velune expects
                    sessionId: "sess-" + randomCode,
                    hostId: "host-" + Date.now(),
                    participants: [],
                    settings: roomSettings,
                    queue: [],
                    queueHash: "",
                    currentIndex: 0,
                    isPlaying: false,
                    positionMs: 0,
                    repeatMode: 0,
                    shuffleEnabled: false,
                    sentAtElapsedRealtimeMs: 0
                }
            };

            // Success! Send the exact JSON 'TogetherOnlineCreateSessionResponse' expects
            res.writeHead(200);
            res.end(JSON.stringify({
                sessionId: activeSessions[randomCode].sessionId,
                code: activeSessions[randomCode].code,
                hostKey: activeSessions[randomCode].hostKey,
                guestKey: activeSessions[randomCode].guestKey,
                wsUrl: activeSessions[randomCode].wsUrl,
                settings: activeSessions[randomCode].settings
            }));
            return;
        }
    });
});

// 4. WEBSOCKET SERVER
const wss = new WebSocket.Server({ server, path: '/v1/together/ws' });

wss.on('connection', function connection(ws, req) {
    console.log("A client is attempting to connect to WebSockets...");
    
    // Grab the session ID from the URL (e.g., ?sid=sess-402599)
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const sessionId = urlParams.get('sid');
    
    // Find the room
    const roomCode = Object.keys(activeSessions).find(code => activeSessions[code].sessionId === sessionId);
    const room = activeSessions[roomCode];

    if (!room) {
        console.log("Room not found, closing connection.");
        ws.close();
        return;
    }

    room.clients.add(ws);
    console.log(`User joined room ${roomCode}!`);

    // --- THE MAGIC HANDSHAKE ---
    // 1. Send ServerWelcome
    const welcomeMessage = {
        type: "server_welcome",
        protocolVersion: 1,
        sessionId: room.sessionId,
        participantId: "guest-" + Math.floor(Math.random() * 10000),
        role: "GUEST", // Or "HOST" if you want to verify keys later
        isPending: false,
        settings: room.settings
    };
    ws.send(JSON.stringify(welcomeMessage));

    // 2. Send RoomStateMessage immediately after
    const stateMessage = {
        type: "room_state",
        state: room.currentState 
    };
    ws.send(JSON.stringify(stateMessage));

    // --- MESSAGE ROUTER ---
    ws.on('message', function incoming(message) {
        // Broadcast incoming actions to everyone else in this specific room
        room.clients.forEach(function each(client) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message.toString());
            }
        });
    });

    ws.on('close', () => {
        room.clients.delete(ws);
        console.log(`User left room ${roomCode}.`);
    });
});

const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`Velune Backend listening on port ${port}`);
});
