import express from 'express';
import session from 'express-session';
import SQLiteStoreFactory from 'connect-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';
import multer from 'multer';
import Database from 'better-sqlite3';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import * as Diff from 'diff';   // ✅ FIXED import

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);

const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');

// ----------------- DB INIT -----------------
function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repos(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      is_private INTEGER DEFAULT 0,
      stars_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner_id, name),
      FOREIGN KEY(owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS stars(
      user_id INTEGER NOT NULL,
      repo_id INTEGER NOT NULL,
      PRIMARY KEY(user_id, repo_id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(repo_id) REFERENCES repos(id)
    );

    CREATE TABLE IF NOT EXISTS commits(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      FOREIGN KEY(repo_id) REFERENCES repos(id),
      FOREIGN KEY(author_id) REFERENCES users(id)
    );
  `);

  // Seed default user
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const pwd = bcrypt.hashSync('password123', 10);
    const info = db.prepare('INSERT INTO users(username, email, password_hash) VALUES(?,?,?)')
      .run('alex', 'alex@example.com', pwd);
    const owner_id = info.lastInsertRowid;

    const now = new Date().toISOString();
    const repo = db.prepare('INSERT INTO repos(owner_id, name, description, is_private, stars_count, created_at, updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(owner_id, 'hello-world', 'My first CodeHub repo', 0, 3, now, now);

    const initialSnapshot = {
      'README.md': '# Hello CodeHub\n\nThis is a sample repository.\n'
    };

    db.prepare(`INSERT INTO commits(repo_id, author_id, message, created_at, snapshot)
                VALUES(?,?,?,?,?)`)
      .run(repo.lastInsertRowid, owner_id, 'Initial commit', now, JSON.stringify(initialSnapshot));
  }
}
initDB();

// ----------------- APP SETUP -----------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));
app.use(cookieParser());
app.use('/public', express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
  secret: 'codehub_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ----------------- ROUTES -----------------
app.get('/', (req, res) => {
  const repos = db.prepare(`SELECT repos.*, users.username FROM repos 
                            JOIN users ON users.id = repos.owner_id
                            ORDER BY stars_count DESC, updated_at DESC LIMIT 12`).all();
  res.render('home', { repos, user: req.session.user, title: 'CodeHub' });
});

app.get('/login', (req, res) => res.render('auth_login', { user: req.session.user, next: '/', title: 'Login' }));
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('auth_login', { user: null, error: 'Invalid credentials', next: '/', title: 'Login' });
  }
  req.session.user = user;
  res.redirect('/');
});

app.get('/register', (req, res) => res.render('auth_register', { user: req.session.user, title: 'Register' }));
app.post('/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.render('auth_register', { error: 'All fields required', user: null });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare('INSERT INTO users(username,email,password_hash) VALUES(?,?,?)')
                   .run(username.trim(), email.trim().toLowerCase(), hash);
    req.session.user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.redirect('/');
  } catch {
    res.render('auth_register', { error: 'Username or email already in use', user: null });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// (Other repo, commit, issue, search routes here – already provided in your views)

// ----------------- SERVER -----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CodeHub running at http://localhost:${PORT}`);
});
