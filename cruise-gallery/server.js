const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const GALLERY_PASSCODE = process.env.GALLERY_PASSCODE || 'cruise70';
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || 'changeme';

// Determine photos directory
const RAILWAY_PHOTOS_DIR = '/data/photos';
const LOCAL_PHOTOS_DIR = path.join(__dirname, 'photos');

let PHOTOS_DIR;
try {
  fs.accessSync('/data', fs.constants.W_OK);
  PHOTOS_DIR = RAILWAY_PHOTOS_DIR;
} catch {
  PHOTOS_DIR = LOCAL_PHOTOS_DIR;
}

const META_FILE = path.join(PHOTOS_DIR, 'meta.json');

// Ensure photos dir exists
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

// Initialize meta.json if it doesn't exist
if (!fs.existsSync(META_FILE)) {
  fs.writeFileSync(META_FILE, JSON.stringify([], null, 2));
}

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/public', express.static(path.join(__dirname, 'public')));

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PHOTOS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const timestamp = Date.now();
    cb(null, `photo_${timestamp}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|heic|heif/i;
    if (allowed.test(path.extname(file.originalname)) || allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Helpers
function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function appendMeta(entry) {
  const meta = readMeta();
  meta.push(entry);
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

function checkUploadSecret(req) {
  const authHeader = req.headers['authorization'];
  const secretHeader = req.headers['x-upload-secret'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7) === UPLOAD_SECRET;
  }
  return secretHeader === UPLOAD_SECRET;
}

function requireAuth(req, res, next) {
  if (req.cookies && req.cookies.cruise_auth === 'ok') {
    return next();
  }
  res.redirect('/login');
}

// Routes
app.get('/', (req, res) => {
  if (req.cookies && req.cookies.cruise_auth === 'ok') {
    return res.redirect('/gallery');
  }
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/auth', (req, res) => {
  const { passcode } = req.body;
  if (passcode === GALLERY_PASSCODE) {
    res.cookie('cruise_auth', 'ok', {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    return res.redirect('/gallery');
  }
  res.redirect('/login?error=wrong');
});

app.post('/logout', (req, res) => {
  res.clearCookie('cruise_auth');
  res.redirect('/login');
});

app.get('/gallery', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gallery.html'));
});

app.post('/upload', upload.single('photo'), (req, res) => {
  if (!checkUploadSecret(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No photo provided' });
  }

  let sender, caption;
  if (req.body.metadata) {
    try {
      const meta = JSON.parse(req.body.metadata);
      sender = meta.sender;
      caption = meta.caption;
    } catch {
      sender = req.body.sender;
      caption = req.body.caption;
    }
  } else {
    sender = req.body.sender;
    caption = req.body.caption;
  }

  const entry = {
    filename: req.file.filename,
    uploadedAt: new Date().toISOString(),
    ...(sender && { sender }),
    ...(caption && { caption })
  };

  appendMeta(entry);

  res.json({ ok: true, filename: req.file.filename });
});

app.get('/photos/:filename', requireAuth, (req, res) => {
  const filepath = path.join(PHOTOS_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(filepath);
});

app.get('/download/:filename', requireAuth, (req, res) => {
  const filepath = path.join(PHOTOS_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.download(filepath);
});

app.get('/api/photos', requireAuth, (req, res) => {
  const meta = readMeta();
  const photos = meta
    .map(entry => ({
      filename: entry.filename,
      url: `/photos/${entry.filename}`,
      downloadUrl: `/download/${entry.filename}`,
      uploadedAt: entry.uploadedAt,
      ...(entry.sender && { sender: entry.sender }),
      ...(entry.caption && { caption: entry.caption })
    }))
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

  res.json(photos);
});

// Error handler for multer
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: 'File too large (max 50MB)' });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: err.message });
});

app.listen(PORT, () => {
  console.log(`Cruise Gallery running on port ${PORT}`);
  console.log(`Photos directory: ${PHOTOS_DIR}`);
});
