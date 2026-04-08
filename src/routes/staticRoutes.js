const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return null;
  }
}

const noCache = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
};

const PUBLIC_DIR = path.join(__dirname, '../../public');

router.get('/', (req, res) => {
  const content = readFileSafe(path.join(PUBLIC_DIR, 'index.html'));
  if (content) {
    res.setHeader('Content-Type', 'text/html');
    noCache(res);
    res.send(content);
  } else {
    res.status(500).send('Error loading page');
  }
});

router.get('/adminprivado2026', (req, res) => {
  const content = readFileSafe(path.join(PUBLIC_DIR, 'adminprivado2026', 'index.html'));
  if (content) {
    res.setHeader('Content-Type', 'text/html');
    noCache(res);
    res.send(content);
  } else {
    res.status(500).send('Error loading admin page');
  }
});

router.get('/adminprivado2026/admin.css', (req, res) => {
  const content = readFileSafe(path.join(PUBLIC_DIR, 'adminprivado2026', 'admin.css'));
  if (content) {
    res.setHeader('Content-Type', 'text/css');
    res.send(content);
  } else {
    res.status(404).send('CSS not found');
  }
});

router.get('/adminprivado2026/admin.js', (req, res) => {
  const content = readFileSafe(path.join(PUBLIC_DIR, 'adminprivado2026', 'admin.js'));
  if (content) {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(content);
  } else {
    res.status(404).send('JS not found');
  }
});

// SPA fallback - serves index.html for non-API routes
router.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint no encontrado' });
  }
  const content = readFileSafe(path.join(PUBLIC_DIR, 'index.html'));
  if (content) {
    res.setHeader('Content-Type', 'text/html');
    noCache(res);
    res.send(content);
  } else {
    res.status(500).send('Error loading page');
  }
});

module.exports = router;
