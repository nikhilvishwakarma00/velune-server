const http = require('http');
const WebSocket = require('ws');


const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Velune Server is awake and healthy!');
});


const wss = new WebSocket.Server({ server });

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

const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`Velune Server running on port ${port}`);
});
