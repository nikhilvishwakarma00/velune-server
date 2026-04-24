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
    console.log("A client connected! Waiting for ClientHello...");
    
    // We store the room here once the client introduces themselves
    let assignedRoom = null;

    ws.on('message', function incoming(message) {
        const parsedMessage = JSON.parse(message.toString());

        // --- THE MAGIC HANDSHAKE ---
        // Velune connects and immediately says "client_hello". We MUST reply to this!
        if (parsedMessage.type === "client_hello") {
            const requestedSessionId = parsedMessage.sessionId;
            
            // Find the room they are asking for
            const roomCode = Object.keys(activeSessions).find(code => activeSessions[code].sessionId === requestedSessionId);
            assignedRoom = activeSessions[roomCode];

            if (!assignedRoom) {
                console.log("Room not found. Closing connection.");
                ws.close();
                return;
            }

            assignedRoom.clients.add(ws);
            console.log(`User ${parsedMessage.displayName} joined room ${roomCode}!`);

            // 1. Send ServerWelcome
            ws.send(JSON.stringify({
                type: "server_welcome",
                protocolVersion: 1,
                sessionId: assignedRoom.sessionId,
                participantId: parsedMessage.clientId,
                role: "GUEST", 
                isPending: false,
                settings: assignedRoom.settings
            }));

            // 2. Send RoomStateMessage immediately after
            ws.send(JSON.stringify({
                type: "room_state",
                state: assignedRoom.currentState 
            }));
            return; // Handshake complete!
        }

        // --- NORMAL MESSAGE ROUTER ---
        // If it's a Play/Pause/Add Track command, broadcast it to everyone else
        if (assignedRoom) {
            assignedRoom.clients.forEach(function each(client) {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(message.toString());
                }
            });
        }
    });

    ws.on('close', () => {
        if (assignedRoom) {
            assignedRoom.clients.delete(ws);
            console.log(`A user left.`);
        }
    });
});

