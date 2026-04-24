const express = require('express');
const app = express();
const port = 8080;

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Brimble Sample</title></head>
    <body style="font-family: monospace; text-align: center; padding: 50px;">
      <h1 style="color: #00ff00;">✓ Deployed with Brimble!</h1>
      <p>Railpack build + Docker container + Caddy routing</p>
    </body>
    </html>
  `);
});

app.listen(port, () => console.log(`Sample app on port ${port}`));
