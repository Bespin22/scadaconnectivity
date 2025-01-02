const express = require('express');
const ping = require('ping');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

let ipList = [];

// Endpoint to fetch the ping results
app.get('/ping', async (req, res) => {
    const results = await Promise.all(
        ipList.map(async (entry) => {
            const response = await ping.promise.probe(entry.ip);
            return {
                name: entry.name,
                ip: entry.ip,
                alive: response.alive && response.time < 500, // Consider <500ms as reachable
                statusCode: response.alive ? 200 : 404,
            };
        })
    );
    res.json(results);
});

// Endpoint to add a new IP address
app.post('/add-ip', (req, res) => {
    const { name, ip } = req.body;
    if (name && ip) {
        ipList.push({ name, ip });
        res.status(201).send({ message: 'IP added successfully' });
    } else {
        res.status(400).send({ message: 'Invalid input' });
    }
});

// Endpoint to delete an IP address
app.delete('/delete-ip/:ip', (req, res) => {
    const { ip } = req.params;
    ipList = ipList.filter((entry) => entry.ip !== ip);
    res.send({ message: 'IP deleted successfully' });
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
