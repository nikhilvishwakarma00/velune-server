const WebSocket = require('ws');


const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: port });

console.log(`Velune Signaling Server starting on port ${port}`);

wss.on('connection', function connection(ws) {
  console.log("New Velune client connected!");

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
