const http = require('http');
const WebSocket = require('ws');


const server = http.createServer((req, res) => {
    
    
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Velune Server is awake and healthy!');
        return;
    }

    
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
        
        const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        
        const sessionData = {
            roomCode: randomCode,
            sessionToken: "velune-admin-token-" + randomCode, 
            userId: "host-" + Math.floor(Math.random() * 10000), 
            isHost: true 
        };

        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(sessionData));
    });
});


const wss = new WebSocket.Server({ server });

wss.on('connection', function connection(ws) {
  console.log("New Velune client connected to the live room!");

  ws.on('message', function incoming(message) {
    wss.clients.forEach(function each(client) {
      
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message.toString());
      }
    });
  });

  ws.on('close', () => {
    console.log("Client disconnected.");
  });
});


const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`Velune Server running on port ${port}`);
});
