const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const ping = require("ping");
const fs = require("fs");

const app = express();
const PORT = 3000;
const DATA_FILE = "ipList.json";

app.use(bodyParser.json());
app.use(cors());

// Load IP list from file or initialize
let ipList = [];
let deletedIps = [];

function loadIPList() {
  if (fs.existsSync(DATA_FILE)) {
    const data = fs.readFileSync(DATA_FILE, "utf-8");
    ipList = JSON.parse(data).ipList || [];
    deletedIps = JSON.parse(data).deletedIps || [];
  }
}

function saveIPList() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ ipList, deletedIps }, null, 2));
}

// Load data on startup
loadIPList();

// Endpoint to fetch all IPs and their statuses
app.get("/ping", async (req, res) => {
  const pingResults = await Promise.all(
    ipList.map((entry) =>
      ping.promise.probe(entry.ip).then((result) => ({
        name: entry.name,
        ip: entry.ip,
        statusCode: result.alive ? 200 : 500,
      }))
    )
  );

  ipList = ipList.map((entry, index) => ({
    ...entry,
    status:
      pingResults[index] && pingResults[index].statusCode === 200
        ? "Connected"
        : "Disconnected",
  }));

  saveIPList();
  res.json(ipList);
});

// Add a new IP to the list
app.post("/add-ip", (req, res) => {
  const { name, ip } = req.body;
  if (name && ip) {
    ipList.push({ name, ip, status: "Pending" });
    saveIPList();
    res.status(201).json({ message: "IP added successfully." });
  } else {
    res.status(400).json({ message: "Name and IP are required." });
  }
});

// Delete an IP from the list
app.delete("/delete-ip/:ip", (req, res) => {
  const { ip } = req.params;
  const index = ipList.findIndex((entry) => entry.ip === ip);
  if (index !== -1) {
    deletedIps.push(ipList[index]);
    ipList.splice(index, 1);
    saveIPList();
    res.json({ message: "IP deleted successfully." });
  } else {
    res.status(404).json({ message: "IP not found." });
  }
});

// Restore a deleted IP
app.post("/restore-ip/:ip", (req, res) => {
  const { ip } = req.params;
  const index = deletedIps.findIndex((entry) => entry.ip === ip);
  if (index !== -1) {
    ipList.push(deletedIps[index]);
    deletedIps.splice(index, 1);
    saveIPList();
    res.json({ message: "IP restored successfully." });
  } else {
    res.status(404).json({ message: "IP not found in deleted list." });
  }
});

// Fetch deleted IPs
app.get("/deleted-ips", (req, res) => {
  res.json(deletedIps);
});

// Periodically update ping status
function updatePingStatus() {
  setInterval(async () => {
    const pingResults = await Promise.all(
      ipList.map((entry) =>
        ping.promise.probe(entry.ip).then((result) => ({
          name: entry.name,
          ip: entry.ip,
          statusCode: result.alive ? 200 : 500,
        }))
      )
    );

    ipList = ipList.map((entry, index) => ({
      ...entry,
      status:
        pingResults[index] && pingResults[index].statusCode === 200
          ? "Connected"
          : "Disconnected",
    }));

    saveIPList();
    console.log("Updated ping status:", ipList);
  }, 5000);
}

// Start the periodic ping status update
updatePingStatus();

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
