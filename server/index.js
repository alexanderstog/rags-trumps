const http = require('http');
const { app, io } = require('./app');

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
io.attach(server);

server.listen(PORT, () => {
  console.log(`Top Trumps Golf running at http://localhost:${PORT}`);
});
