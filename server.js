const express = require('express');
const app = express();
const port = process.env.PORT || 5000;

app.get('/', (req, res) => {
  res.send('<h1>Deployment Successful!</h1><p>Your Brimble pipeline is working!</p>');
});

app.listen(port, () => {
  console.log(`Test app running on port ${port}`);
});
