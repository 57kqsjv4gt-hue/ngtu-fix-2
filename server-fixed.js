const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// ========== НАСТРОЙКА ПАПОК ==========
const uploadsDir = path.join(__dirname, 'uploads');
const receiptsDir = path.join(__dirname, 'uploads', 'receipts');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });

// ========== MULTER ==========
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, receiptsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `receipt-${Date.now()}-${Math.round(Math.random()*1E9)}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.jpg','.jpeg','.png','.pdf','.gif'].includes(ext)) cb(null, true);
        else cb(new Error('Допустимы только JPG, PNG, PDF, GIF'));
    }
});

// ========== MIDDLEWARE ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    next();
});

// Игнорируем запросы на иконки
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/apple-touch-icon*.png', (req, res) => res.status(204).end());

// ========== БАЗА ДАННЫХ ==========
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('❌ Ошибка подключения к БД:', err.message);
        process.exit(1);
    } else {
        console.log('✅ БД подключена');
        initializeDatabase();
    }
});

function initializeDatabase() {
    console.log('📝 Инициализация БД...');

    // Создаём таблицу applications
    db.run(`CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        section TEXT NOT NULL,
        status TEXT DEFAULT 'Новая',
        has_receipt INTEGER DEFAULT 0,
        receipt_filename TEXT,
        receipt_path TEXT,
        receipt_uploaded_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, function(err) {
        if (err) {
            console.error('❌ Ошибка создания applications:', err.message);
        } else {
            console.log('✅ Таблица applications создана/проверена');
        }
    });

    // Создаём таблицу users
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'student',
        full_name TEXT,
        phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, function(err) {
        if (err) {
            console.error('❌ Ошибка создания users:', err.message);
        } else {
            console.log('✅ Таблица users создана/проверена');

            // Создаём админа
            const hash = bcrypt.hashSync('admin123', 10);
            db.run(`INSERT OR IGNORE INTO users (username, password, role, full_name)
                   VALUES ('admin', ?, 'admin', 'Администратор')`, [hash],
                function(err) {
                    if (!err && this.changes > 0) {
                        console.log('✅ Создан админ: admin / admin123');
                    }
                }
            );
        }
    });
}

// ========== API ==========

app.get('/api/test', (req, res) => {
    res.json({ success: true, message: 'Сервер работает!', time: new Date().toISOString() });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, error: 'Введите логин и пароль' });

    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) {
            console.error('❌ Ошибка БД:', err.message);
            return res.json({ success: false, error: 'Ошибка сервера' });
        }
        if (!user) return res.json({ success: false, error: 'Неверный логин или пароль' });
        if (!bcrypt.compareSync(password, user.password)) {
            return res.json({ success: false, error: 'Неверный логин или пароль' });
        }

        console.log(`✅ Вход: ${user.username} | Роль: ${user.role}`);
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                role: (user.role || 'student').toLowerCase(),
                full_name: user.full_name,
                phone: user.phone
            }
        });
    });
});

app.post('/api/student/register', (req, res) => {
    const { full_name, username, password, phone } = req.body;
    if (!full_name || !username || !password || !phone) {
        return res.json({ success: false, error: 'Заполните все поля' });
    }

    const hash = bcrypt.hashSync(password, 10);
    db.run('INSERT INTO users (username, password, role, full_name, phone) VALUES (?, ?, ?, ?, ?)',
        [username, hash, 'student', full_name, phone.replace(/\D/g,'')],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.json({ success: false, error: 'Логин уже занят' });
                }
                console.error('❌ Регистрация:', err.message);
                return res.json({ success: false, error: 'Ошибка сервера' });
            }
            console.log('✅ Регистрация:', username);
            res.json({ success: true, message: 'Аккаунт создан', userId: this.lastID });
        });
});

// 🔧 ИСПРАВЛЕННЫЙ запрос - без алиасов
app.get('/api/applications', (req, res) => {
    console.log('📥 Запрос всех заявок');

    db.all(`SELECT
        id, student_name, phone, section, status,
        has_receipt, receipt_filename, receipt_path, receipt_uploaded_at,
        created_at,
        strftime('%d.%m.%Y', created_at) as date
    FROM applications
    ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) {
            console.error('❌ Ошибка БД:', err.message);
            return res.json({ success: false, error: err.message });
        }

        console.log('✅ Найдено заявок:', rows ? rows.length : 0);

        const applications = (rows || []).map(row => ({
            id: '#' + row.id,
            db_id: row.id,
            student_name: row.student_name,
            phone: row.phone,
            section: row.section,
            status: row.status,
            has_receipt: Boolean(row.has_receipt),
            receipt_filename: row.receipt_filename,
            date: row.date,
            receipt_uploaded_at: row.receipt_uploaded_at,
            receipt_url: row.receipt_filename ? '/uploads/receipts/' + row.receipt_filename : null
        }));

        res.json({ success: true, applications: applications, count: applications.length });
    });
});

app.post('/api/applications/find', (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.json({ success: false, error: 'Введите телефон' });

    const clean = phone.replace(/\D/g,'');
    db.all(`SELECT
        id, student_name, section, status, has_receipt, receipt_filename,
        strftime('%d.%m.%Y', created_at) as date
    FROM applications
    WHERE phone LIKE '%' || ? || '%'
    ORDER BY created_at DESC`, [clean], (err, rows) => {
        if (err) {
            console.error('❌ Ошибка поиска:', err.message);
            return res.json({ success: false, error: 'Ошибка поиска' });
        }

        const apps = (rows || []).map(r => ({
            ...r,
            id: '#' + r.id,
            has_receipt: Boolean(r.has_receipt),
            receipt_url: r.receipt_filename ? '/uploads/receipts/' + r.receipt_filename : null
        }));

        console.log('✅ Найдено заявок:', apps.length);
        res.json({ success: true, applications: apps });
    });
});

app.post('/api/applications/:id/receipt/upload', upload.single('receipt'), (req, res) => {
    let id = req.params.id.replace('#','');
    if (!req.file) return res.json({ success: false, error: 'Файл не выбран' });

    db.get('SELECT status FROM applications WHERE id = ?', [id], (err, app) => {
        if (!app) {
            fs.unlinkSync(req.file.path);
            return res.json({ success: false, error: 'Заявка не найдена' });
        }
        if (app.status !== 'Ожидает оплаты') {
            fs.unlinkSync(req.file.path);
            return res.json({ success: false, error: 'Чек загружается только при статусе "Ожидает оплаты"' });
        }
        db.run(`UPDATE applications SET has_receipt=1, receipt_filename=?, receipt_path=?, receipt_uploaded_at=CURRENT_TIMESTAMP WHERE id=?`,
            [req.file.filename, 'uploads/receipts/'+req.file.filename, id], err => {
                if (err) {
                    fs.unlinkSync(req.file.path);
                    return res.json({ success: false, error: err.message });
                }
                res.json({ success: true, message: 'Чек загружен', file: { name: req.file.filename, url: '/uploads/receipts/'+req.file.filename } });
            });
    });
});

app.delete('/api/applications/:id/receipt', (req, res) => {
    let id = req.params.id.replace('#','');
    db.get('SELECT receipt_filename FROM applications WHERE id=?', [id], (err, app) => {
        if (!app) return res.json({ success: false, error: 'Не найдено' });
        if (app.receipt_filename) {
            const p = path.join(receiptsDir, app.receipt_filename);
            if (fs.existsSync(p)) fs.unlinkSync(p);
        }
        db.run(`UPDATE applications SET has_receipt=0, receipt_filename=NULL, receipt_path=NULL, receipt_uploaded_at=NULL WHERE id=?`, [id], err => {
            if (err) return res.json({ success: false, error: err.message });
            res.json({ success: true, message: 'Чек удалён' });
        });
    });
});

app.post('/api/applications/create', (req, res) => {
    const { student_name, phone, section } = req.body;
    if (!student_name || !phone || !section) return res.json({ success: false, error: 'Заполните все поля' });
    const cleanPhone = phone.replace(/\D/g,'');

    db.get('SELECT COUNT(*) as c FROM applications WHERE section=? AND status!="Отклонено"', [section], (err, row) => {
        if (row.c >= 25) return res.json({ success: false, error: 'Секция заполнена (макс. 25)' });
        db.run(`INSERT INTO applications (student_name, phone, section, status) VALUES (?, ?, ?, 'Новая')`,
            [student_name, cleanPhone, section], function(err) {
            if (err) return res.json({ success: false, error: err.message });
            res.json({ success: true, applicationId: this.lastID });
        });
    });
});

app.get('/api/stats', (req, res) => {
    db.get(`SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='Новая' THEN 1 ELSE 0 END) as new_applications,
        SUM(CASE WHEN status='Ожидает оплаты' THEN 1 ELSE 0 END) as pending_payment,
        SUM(CASE WHEN status='Подтверждено' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN has_receipt=1 THEN 1 ELSE 0 END) as with_receipt
    FROM applications`, [], (err, row) => {
        if (err) {
            console.error('❌ Ошибка статистики:', err.message);
            return res.json({ success: false, error: err.message });
        }
        res.json({
            success: true,
            stats: row || { total:0, new_applications:0, pending_payment:0, confirmed:0, with_receipt:0 }
        });
    });
});

app.get('/api/sections/stats', (req, res) => {
    const secs = ['Баскетбол','Волейбол','Футбол','Плавание','Теннис'];
    db.all(`SELECT section,
        COUNT(*) as enrolled,
        SUM(CASE WHEN status='Подтверждено' THEN 1 ELSE 0 END) as confirmed
    FROM applications
    WHERE section IN (${secs.map(()=>'?').join(',')})
    GROUP BY section`, secs, (err, rows) => {
        if (err) {
            console.error('❌ Ошибка статистики секций:', err.message);
            return res.json({ success: false, error: err.message });
        }
        const stats = secs.map(s => {
            const r = rows.find(x => x.section === s) || { enrolled:0, confirmed:0 };
            return {
                name: s,
                enrolled: r.enrolled,
                confirmed: r.confirmed,
                available: Math.max(0, 25-r.enrolled),
                isFull: r.enrolled >= 25
            };
        });
        res.json({ success: true, sections: stats });
    });
});

app.put('/api/applications/:id/status', (req, res) => {
    let id = req.params.id.replace('#','');
    if (!req.body.status) return res.json({ success: false, error: 'Укажите статус' });
    db.run('UPDATE applications SET status=? WHERE id=?', [req.body.status, id], function(err) {
        if (err) return res.json({ success: false, error: err.message });
        res.json({ success: true, changes: this.changes });
    });
});

app.delete('/api/applications/:id', (req, res) => {
    let id = req.params.id.replace('#','');
    const idNum = parseInt(id);
    if (isNaN(idNum)) return res.status(400).json({ success: false, error: 'Неверный ID' });

    db.get('SELECT receipt_filename FROM applications WHERE id=?', [idNum], (err, app) => {
        if (!app) return res.status(404).json({ success: false, error: 'Не найдено' });
        if (app.receipt_filename) {
            const p = path.join(receiptsDir, app.receipt_filename);
            if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch(e){}
        }
        db.run('DELETE FROM applications WHERE id=?', [idNum], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, message: 'Удалено', deletedId: idNum });
        });
    });
});

// 🔧 Отладочный эндпоинт для проверки таблиц
app.get('/api/debug/tables', (req, res) => {
    db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", [], (err, tables) => {
        if (err) return res.json({ success: false, error: err.message });
        res.json({ success: true, tables: tables });
    });
});

// ========== РОУТЫ ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-fixed.html')));
app.get('/student', (req, res) => res.sendFile(path.join(__dirname, 'public', 'student-cabinet.html')));
app.get('/apply', (req, res) => res.redirect('/'));
app.get('/receipt', (req, res) => res.redirect('/'));
app.get('/find', (req, res) => res.redirect('/'));

app.use((req, res) => res.status(404).json({ success: false, error: 'Не найдено' }));
app.use((err, req, res, next) => {
    console.error('💥 Ошибка:', err.message);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка' });
});

app.listen(PORT, () => {
    console.log('\n'+'='.repeat(50)+'\n🚀 СЕРВЕР ЗАПУЩЕН\n'+'='.repeat(50));
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`👑 Admin: http://localhost:${PORT}/admin (admin/admin123)\n`);
});