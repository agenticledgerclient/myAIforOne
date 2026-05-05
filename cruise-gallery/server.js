const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const GALLERY_PASSCODE = process.env.GALLERY_PASSCODE || 'cruise70';
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || ('admin_' + GALLERY_PASSCODE);
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || 'changeme';
const MUSIC_VIDEO_ID = process.env.MUSIC_VIDEO_ID || '3GwjfUFyY6M'; // Kool & the Gang — Celebration
// MUSIC_PLAYLIST: comma-separated YouTube video IDs. Falls back to default two-track playlist if not set.
const MUSIC_PLAYLIST = process.env.MUSIC_PLAYLIST
  ? process.env.MUSIC_PLAYLIST.split(',').map(s => s.trim()).filter(Boolean)
  : [
    MUSIC_VIDEO_ID,    // 1. Kool & the Gang — Celebration
    'Qwscb3QIVSg',     // 2. Stevie Wonder — Happy Birthday
    'HNBCVM4KbUM',     // 3. Bob Marley — Three Little Birds
    'vkrYlEeTF7Y',     // 4. Bob Marley — One Love (4K Remaster)
    '_4JPM52EXGU',     // 5. Bob Marley — Could You Be Loved (4K Remaster)
    'Gs069dndIYk',     // 6. Earth, Wind & Fire — September
    'bEeaS6fuUoA',     // 7. Bill Withers — Lovely Day
    'ZbZSe6N_BXs',     // 8. Pharrell Williams — Happy
    'uyGY2NfYpeE',     // 9. Sister Sledge — We Are Family
    'DOYhayZ9y7k',     // 10. Diana Ross — Ain't No Mountain High Enough
  ];

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

function writeMeta(meta) {
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

function appendMeta(entry) {
  const meta = readMeta();
  meta.push(entry);
  writeMeta(meta);
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
  const c = req.cookies && req.cookies.cruise_auth;
  if (c === 'ok' || c === 'admin') return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.cookies && req.cookies.cruise_auth === 'admin') return next();
  res.status(403).json({ ok: false, error: 'Forbidden' });
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
  if (passcode === ADMIN_PASSCODE) {
    res.cookie('cruise_auth', 'admin', { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    return res.redirect('/gallery');
  }
  if (passcode === GALLERY_PASSCODE) {
    res.cookie('cruise_auth', 'ok', { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
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

// Web upload — authenticated via cookie (no secret needed)
app.post('/upload-web', requireAuth, upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No photo provided' });
  }

  const sender = (req.body.name || '').trim() || null;
  const caption = (req.body.caption || '').trim() || null;

  const entry = {
    filename: req.file.filename,
    uploadedAt: new Date().toISOString(),
    source: 'web',
    ...(sender && { sender }),
    ...(caption && { caption })
  };

  appendMeta(entry);
  res.json({ ok: true, filename: req.file.filename });
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

app.get('/api/config', requireAuth, (req, res) => {
  res.json({ musicVideoId: MUSIC_VIDEO_ID, playlist: MUSIC_PLAYLIST });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ isAdmin: req.cookies.cruise_auth === 'admin' });
});

// ── Admin endpoints ──────────────────────────────────────────

app.delete('/admin/photo/:filename', requireAdmin, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(PHOTOS_DIR, filename);

  // Remove from meta
  const meta = readMeta();
  const filtered = meta.filter(e => e.filename !== filename);
  writeMeta(filtered);

  // Delete file (best-effort)
  try { fs.unlinkSync(filepath); } catch {}

  res.json({ ok: true });
});

app.put('/admin/photo/:filename', requireAdmin, (req, res) => {
  const filename = path.basename(req.params.filename);
  const { caption, sender } = req.body;

  const meta = readMeta();
  const entry = meta.find(e => e.filename === filename);
  if (!entry) return res.status(404).json({ ok: false, error: 'Not found' });

  if (caption !== undefined) entry.caption = caption || undefined;
  if (sender !== undefined) entry.sender = sender || undefined;
  // Clean up undefined keys
  if (!entry.caption) delete entry.caption;
  if (!entry.sender) delete entry.sender;

  writeMeta(meta);
  res.json({ ok: true, entry });
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
