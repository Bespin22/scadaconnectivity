const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const ping = require('ping');

const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(cors());

let ipList = [];

// Get all IPs and their statuses
app.get('/ping', (req, res) => {
    const results = ipList.map(async (ipEntry) => {
        const pingResult = await ping.promise.probe(ipEntry.ip);
        return {
            name: ipEntry.name,
            ip: ipEntry.ip,
            alive: pingResult.alive
        };
    });

    Promise.all(results).then((statuses) => {
        res.json(statuses);
    });
});

// Add a new IP
app.post('/add-ip', (req, res) => {
    const { name, ip } = req.body;

    if (!name || !ip) {
        return res.status(400).json({ error: 'Name and IP are required' });
    }

    ipList.push({ name, ip });
    res.status(201).json({ message: 'IP added successfully' });
});

// Delete an IP
app.delete('/delete-ip/:ip', (req, res) => {
    const ipToDelete = req.params.ip;
    ipList = ipList.filter((entry) => entry.ip !== ipToDelete);

    res.status(200).json({ message: 'IP deleted successfully' });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:3000`);
});
