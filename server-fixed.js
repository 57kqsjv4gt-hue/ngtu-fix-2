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

app.get('/favicon.ico', (req, res) => res.status(204).end());

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
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'student',
        full_name TEXT,
        phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, function(err) {
        if (!err) {
            const hash = bcrypt.hashSync('admin123', 10);
            db.run(`INSERT OR IGNORE INTO users (username, password, role, full_name) VALUES ('admin', ?, 'admin', 'Администратор')`, [hash]);
        }
    });

    db.run(`CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section TEXT NOT NULL,
        trainer_name TEXT NOT NULL,
        day_of_week TEXT NOT NULL,
        time_slot TEXT NOT NULL,
        capacity INTEGER DEFAULT 25,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, function(err) {
        if (!err) {
            db.get('SELECT COUNT(*) as cnt FROM schedules', (err, row) => {
                if (row && row.cnt === 0) {
                    const testSchedules = [
                        ['Баскетбол', 'Иван Петров', 'Пн', '10:00', 25],
                        ['Баскетбол', 'Иван Петров', 'Ср', '15:30', 25],
                        ['Волейбол', 'Мария Сидорова', 'Вт', '16:00', 20],
                        ['Волейбол', 'Мария Сидорова', 'Чт', '17:00', 20],
                        ['Футбол', 'Петр Иванов', 'Пн', '18:00', 30],
                        ['Футбол', 'Петр Иванов', 'Пт', '19:00', 30],
                        ['Плавание', 'Елена Краснова', 'Ср', '09:00', 15],
                        ['Плавание', 'Елена Краснова', 'Сб', '10:00', 15],
                        ['Теннис', 'Сергей Волков', 'Пт', '14:00', 12],
                        ['Теннис', 'Сергей Волков', 'Вс', '15:00', 12]
                    ];
                    testSchedules.forEach(schedule => {
                        db.run(`INSERT INTO schedules (section, trainer_name, day_of_week, time_slot, capacity) VALUES (?, ?, ?, ?, ?)`, schedule);
                    });
                    console.log('📅 Тестовое расписание добавлено');
                }
            });
        }
    });

    db.run(`CREATE TABLE IF NOT EXISTS enrollments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL UNIQUE,
        schedule_id INTEGER NOT NULL,
        status TEXT DEFAULT 'active',
        enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS waitlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL UNIQUE,
        schedule_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'waiting'
    )`);
}

// ========== API ==========
app.get('/api/test', (req, res) => res.json({ success: true, message: 'Сервер работает!' }));

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err || !user || !bcrypt.compareSync(password, user.password)) {
            return res.json({ success: false, error: 'Неверный логин или пароль' });
        }
        res.json({ success: true, user: { id: user.id, username: user.username, role: (user.role || 'student').toLowerCase(), full_name: user.full_name, phone: user.phone } });
    });
});

app.post('/api/student/register', (req, res) => {
    const { full_name, username, password, phone } = req.body;
    if (!full_name || !username || !password || !phone) return res.json({ success: false, error: 'Заполните все поля' });
    const hash = bcrypt.hashSync(password, 10);
    db.run('INSERT INTO users (username, password, role, full_name, phone) VALUES (?, ?, ?, ?, ?)',
        [username, hash, 'student', full_name, phone.replace(/\D/g,'')], function(err) {
            if (err && err.message.includes('UNIQUE')) return res.json({ success: false, error: 'Логин уже занят' });
            res.json({ success: true, message: 'Аккаунт создан' });
        });
});

app.get('/api/sections/stats', (req, res) => {
    db.all(`SELECT s.section, MAX(s.capacity) as capacity, GROUP_CONCAT(s.day_of_week || ' ' || s.time_slot, ', ') as schedule_info FROM schedules s GROUP BY LOWER(s.section)`, [], (err, scheduleRows) => {
        if (err) return res.json({ success: false, error: err.message });
        if (!scheduleRows || scheduleRows.length === 0) return res.json({ success: true, sections: [] });

        db.all(`SELECT section, COUNT(DISTINCT phone) as enrolled, SUM(CASE WHEN status IN ('Подтверждено', 'Завершено') THEN 1 ELSE 0 END) as confirmed FROM applications GROUP BY LOWER(section)`, [], (err, appRows) => {
            const appMap = {};
            (appRows || []).forEach(r => { appMap[r.section.toLowerCase()] = r; });

            const sections = scheduleRows.map(s => {
                const key = s.section.toLowerCase();
                const appStats = appMap[key] || { enrolled: 0, confirmed: 0 };
                const capacity = s.capacity || 25;
                const enrolled = appStats.enrolled || 0;
                return {
                    name: s.section, enrolled: enrolled, confirmed: appStats.confirmed || 0,
                    capacity: capacity, schedule_info: s.schedule_info,
                    available: Math.max(0, capacity - enrolled), isFull: enrolled >= capacity
                };
            });
            res.json({ success: true, sections });
        });
    });
});

app.post('/api/applications/create', (req, res) => {
    const { student_name, phone, section, course_year } = req.body;
    if (!student_name || !phone || !section) return res.json({ success: false, error: 'Заполните все поля' });
    const cleanPhone = phone.replace(/\D/g,'');

    db.get('SELECT id, status FROM applications WHERE phone = ? AND LOWER(section) = LOWER(?) AND status NOT IN ("Отклонено", "Завершено")',
        [cleanPhone, section], (err, existing) => {
        if (err) return res.json({ success: false, error: err.message });
        if (existing) return res.json({ success: false, error: `У вас уже есть заявка #${existing.id} на эту секцию` });

        db.get(`SELECT
            (SELECT COUNT(*) FROM applications WHERE LOWER(section)=LOWER(?) AND status IN ('Новая', 'Ожидает оплаты', 'Подтверждено', 'Завершено', 'На рассмотрении', 'В списке ожидания')) as enrolled,
            (SELECT MAX(capacity) FROM schedules WHERE LOWER(section)=LOWER(?)) as total_capacity
        `, [section, section], (err, stats) => {
            if (err) return res.json({ success: false, error: err.message });

            const enrolled = stats?.enrolled || 0;
            const capacity = stats?.total_capacity || 0;
            if (capacity === 0) return res.json({ success: false, error: 'Секция не найдена' });

            const targetStatus = (enrolled >= capacity) ? 'На рассмотрении' : 'Новая';

            db.run(`INSERT INTO applications (student_name, phone, section, status) VALUES (?, ?, ?, ?)`,
                [student_name, cleanPhone, section, targetStatus], function(err) {
                    if (err) return res.json({ success: false, error: err.message });
                    const applicationId = this.lastID;

                    if (targetStatus === 'На рассмотрении') {
                        // ✅ ИСПРАВЛЕНО: Находим schedule_id корректно
                        db.get(`SELECT id FROM schedules WHERE LOWER(section) = LOWER(?) ORDER BY id LIMIT 1`, [section], (err, schedule) => {
                            if (err || !schedule) {
                                console.error('❌ Расписание не найдено для секции:', section);
                                return res.json({ success: true, waitlisted: true, applicationId, message: `Секция заполнена. Ваша заявка #${applicationId} принята на рассмотрение администратором.` });
                            }

                            const schedId = schedule.id;
                            db.get(`SELECT COUNT(*) as cnt FROM waitlist WHERE schedule_id = ? AND status = 'waiting'`, [schedId], (err, row) => {
                                const position = (row?.cnt || 0) + 1;
                                db.run(`INSERT INTO waitlist (application_id, schedule_id, position, status) VALUES (?, ?, ?, 'waiting')`,
                                    [applicationId, schedId, position], (err) => {
                                        if (err) {
                                            console.error(' Ошибка добавления в waitlist:', err.message);
                                        } else {
                                            console.log(`✅ Заявка #${applicationId} добавлена в waitlist, позиция ${position}`);
                                        }
                                        res.json({ success: true, waitlisted: true, applicationId, position, message: `Секция заполнена. Ваша заявка #${applicationId} принята и добавлена в лист ожидания на рассмотрение администратором.` });
                                    });
                            });
                        });
                    } else {
                        res.json({ success: true, waitlisted: false, applicationId, message: `Заявка #${applicationId} успешно создана.`, status: 'Новая' });
                    }
                });
        });
    });
});

app.get('/api/applications', (req, res) => {
    db.all(`SELECT id, student_name, phone, section, status, has_receipt, receipt_filename, strftime('%d.%m.%Y', created_at) as date FROM applications ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) return res.json({ success: false, error: err.message });
        const apps = (rows || []).map(r => ({
            id: '#' + r.id, db_id: r.id, student_name: r.student_name, phone: r.phone, section: r.section,
            status: r.status, has_receipt: Boolean(r.has_receipt), date: r.date,
            receipt_url: r.receipt_filename ? '/uploads/receipts/' + r.receipt_filename : null
        }));
        res.json({ success: true, applications: apps });
    });
});

app.post('/api/applications/find', (req, res) => {
    const { phone } = req.body;
    const clean = phone.replace(/\D/g,'');
    db.all(`SELECT id, student_name, section, status, has_receipt, receipt_filename, strftime('%d.%m.%Y', created_at) as date FROM applications WHERE phone LIKE '%' || ? || '%' ORDER BY created_at DESC`, [clean], (err, rows) => {
        if (err) return res.json({ success: false, error: err.message });
        const apps = (rows || []).map(r => ({ ...r, id: '#' + r.id, db_id: r.id, has_receipt: Boolean(r.has_receipt), receipt_url: r.receipt_filename ? '/uploads/receipts/' + r.receipt_filename : null }));
        res.json({ success: true, applications: apps });
    });
});

app.post('/api/applications/:id/receipt/upload', upload.single('receipt'), (req, res) => {
    let id = req.params.id.replace('#','');
    if (!req.file) return res.json({ success: false, error: 'Файл не выбран' });
    db.get('SELECT status FROM applications WHERE id = ?', [id], (err, app) => {
        if (!app) { fs.unlinkSync(req.file.path); return res.json({ success: false, error: 'Заявка не найдена' }); }
        if (app.status !== 'Ожидает оплаты') { fs.unlinkSync(req.file.path); return res.json({ success: false, error: 'Чек только для "Ожидает оплаты"' }); }
        db.run(`UPDATE applications SET has_receipt=1, receipt_filename=?, receipt_path=?, receipt_uploaded_at=CURRENT_TIMESTAMP WHERE id=?`,
            [req.file.filename, 'uploads/receipts/'+req.file.filename, id], err => {
                if (err) { fs.unlinkSync(req.file.path); return res.json({ success: false, error: err.message }); }
                res.json({ success: true, message: 'Чек загружен' });
            });
    });
});

app.get('/api/stats', (req, res) => {
    db.get(`SELECT COUNT(*) as total, SUM(CASE WHEN status='Новая' THEN 1 ELSE 0 END) as new_applications, SUM(CASE WHEN status='Ожидает оплаты' THEN 1 ELSE 0 END) as pending_payment, SUM(CASE WHEN status='Подтверждено' THEN 1 ELSE 0 END) as confirmed, SUM(CASE WHEN has_receipt=1 THEN 1 ELSE 0 END) as with_receipt FROM applications`, [], (err, row) => {
        res.json({ success: true, stats: row || { total:0, new_applications:0, pending_payment:0, confirmed:0, with_receipt:0 } });
    });
});

app.put('/api/applications/:id/status', (req, res) => {
    let id = req.params.id.replace('#','');
    db.run('UPDATE applications SET status=? WHERE id=?', [req.body.status, id], function(err) {
        if (err) return res.json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/applications/:id', (req, res) => {
    let id = parseInt(req.params.id.replace('#',''));
    db.get('SELECT receipt_filename FROM applications WHERE id=?', [id], (err, app) => {
        if (app?.receipt_filename) {
            const p = path.join(receiptsDir, app.receipt_filename);
            if (fs.existsSync(p)) fs.unlinkSync(p);
        }
        db.run('DELETE FROM applications WHERE id=?', [id], err => {
            if (err) return res.json({ success: false, error: err.message });
            res.json({ success: true });
        });
    });
});

// ========== УПРАВЛЕНИЕ СЕКЦИЯМИ ==========
// ✅ ИСПРАВЛЕНО: теперь считает и "На рассмотрении" и "В списке ожидания"
app.get('/api/admin/sections', (req, res) => {
    db.all(`SELECT section, COUNT(DISTINCT id) as slots_count, MAX(capacity) as total_capacity, GROUP_CONCAT(day_of_week || ' ' || time_slot, '; ') as schedule FROM schedules GROUP BY section ORDER BY section`, [], (err, rows) => {
        if (err) return res.json({ success: false, error: err.message });
        const sections = (rows || []).map(row => ({ name: row.section, slotsCount: row.slots_count, totalCapacity: row.total_capacity, schedule: row.schedule, enrolled: 0, waitlist: 0 }));

        // ✅ ИСПРАВЛЕНО: считаем оба статуса очереди
        db.all(`SELECT section,
            COUNT(DISTINCT CASE WHEN status IN ('Подтверждено','Завершено') THEN phone END) as enrolled,
            COUNT(DISTINCT CASE WHEN status IN ('В списке ожидания', 'На рассмотрении') THEN phone END) as waitlist
            FROM applications GROUP BY section`, [], (err2, stats) => {
            const statsMap = {};
            (stats || []).forEach(s => { statsMap[s.section] = s; });
            sections.forEach(sec => {
                const s = statsMap[sec.name] || { enrolled: 0, waitlist: 0 };
                sec.enrolled = s.enrolled; sec.waitlist = s.waitlist;
                sec.occupancy = sec.totalCapacity > 0 ? Math.round((s.enrolled / sec.totalCapacity) * 100) : 0;
            });
            res.json({ success: true, sections });
        });
    });
});

app.post('/api/admin/sections', (req, res) => {
    const { name, trainer, slots, capacity } = req.body;
    if (!name || !trainer || !slots?.length) return res.json({ success: false, error: 'Заполните название, тренера и слоты' });
    const queries = slots.map(slot => new Promise((resolve, reject) => {
        db.run(`INSERT INTO schedules (section, trainer_name, day_of_week, time_slot, capacity) VALUES (?, ?, ?, ?, ?)`, [name, trainer, slot.day, slot.time, capacity || 25], function(err) { err ? reject(err) : resolve(this.lastID); });
    }));
    Promise.all(queries).then(ids => res.json({ success: true, message: `Секция "${name}" добавлена`, slotsCreated: ids.length }))
        .catch(err => res.json({ success: false, error: err.message }));
});

app.put('/api/admin/sections/:name/capacity', (req, res) => {
    const { name } = req.params;
    const { capacity } = req.body;
    if (!capacity || capacity < 1 || capacity > 100) return res.json({ success: false, error: 'Неверная вместимость' });
    db.run(`UPDATE schedules SET capacity = ? WHERE LOWER(section) = LOWER(?)`, [capacity, name], function(err) {
        if (err) return res.json({ success: false, error: err.message });
        res.json({ success: true, message: 'Вместимость обновлена' });
    });
});

app.delete('/api/admin/sections/:name', (req, res) => {
    const { name } = req.params;
    db.get(`SELECT COUNT(*) as cnt FROM applications WHERE section=? AND status IN ('Подтверждено','Завершено')`, [name], (err, row) => {
        if (row?.cnt > 0) return res.json({ success: false, error: `Нельзя удалить: в секции ${row.cnt} зачисленных` });
        db.run(`DELETE FROM schedules WHERE LOWER(section) = LOWER(?)`, [name], function(err) {
            if (err) return res.json({ success: false, error: err.message });
            res.json({ success: true, message: 'Секция удалена' });
        });
    });
});

app.get('/api/admin/enrollments', (req, res) => {
    const { section } = req.query;
    let query = `SELECT a.id, a.student_name, a.phone, a.section, a.status, strftime('%d.%m.%Y', a.created_at) as applied_date, GROUP_CONCAT(s.day_of_week || ' ' || s.time_slot, ', ') as schedules, (SELECT trainer_name FROM schedules s2 WHERE LOWER(s2.section) = LOWER(a.section) LIMIT 1) as trainer FROM applications a LEFT JOIN schedules s ON LOWER(a.section) = LOWER(s.section) WHERE a.status IN ('Подтверждено', 'Завершено')`;
    const params = [];
    if (section) { query += ` AND LOWER(a.section) = LOWER(?)`; params.push(section); }
    query += ` GROUP BY a.id, a.student_name, a.phone, a.section, a.status, applied_date ORDER BY a.section, a.created_at DESC`;
    db.all(query, params, (err, rows) => {
        if (err) return res.json({ success: false, error: err.message });
        const grouped = {};
        (rows || []).forEach(row => {
            if (!grouped[row.section]) grouped[row.section] = { name: row.section, students: [] };
            grouped[row.section].students.push({ id: row.id, name: row.student_name, phone: row.phone, applied: row.applied_date, schedule: row.schedules || 'Не указано', trainer: row.trainer || 'Не указано' });
        });
        res.json({ success: true, enrollments: Object.values(grouped), total: rows?.length || 0 });
    });
});

// ✅ ИСПРАВЛЕНО: теперь ищет оба статуса
app.get('/api/admin/waitlist/all', (req, res) => {
    console.log('📋 Запрос всех очередей');

    // Получаем все секции с заявками в очереди (оба статуса)
    db.all(`SELECT DISTINCT section FROM applications WHERE LOWER(status) IN ('в списке ожидания', 'на рассмотрении') AND section IS NOT NULL`, [], (err, sections) => {
        if (err) {
            console.error('❌ Ошибка получения секций:', err.message);
            return res.json({ success: false, error: err.message });
        }

        const results = {};
        let completed = 0;
        const sectionList = sections.map(s => s.section);

        if (sectionList.length === 0) {
            console.log('✅ Очередей нет');
            return res.json({ success: true, waitlists: {} });
        }

        sectionList.forEach(section => {
            db.all(`SELECT
                a.id,
                a.student_name,
                a.phone,
                a.section,
                a.status,
                strftime('%d.%m.%Y %H:%M', a.created_at) as added_at,
                (SELECT COUNT(*) FROM applications a2
                 WHERE LOWER(a2.section) = LOWER(a.section)
                 AND LOWER(a2.status) IN ('в списке ожидания', 'на рассмотрении')
                 AND a2.created_at <= a.created_at) as position
            FROM applications a
            WHERE LOWER(a.section) = LOWER(?)
              AND LOWER(a.status) IN ('в списке ожидания', 'на рассмотрении')
            ORDER BY a.created_at ASC`, [section], (err, rows) => {
                if (err) {
                    console.error(`Ошибка для секции "${section}":`, err);
                    rows = [];
                }
                results[section] = rows || [];
                completed++;

                if (completed === sectionList.length) {
                    console.log('✅ Отправляю waitlists:',
                        Object.keys(results).map(k => `${k}: ${results[k].length}`));
                    res.json({ success: true, waitlists: results });
                }
            });
        });
    });
});

// ✅ ИСПРАВЛЕНО: зачисление из очереди теперь работает для обоих статусов
app.post('/api/admin/waitlist/:applicationId/enroll', (req, res) => {
    const { applicationId } = req.params;
    db.get('SELECT section, status FROM applications WHERE id = ?', [applicationId], (err, app) => {
        if (!app) return res.json({ success: false, error: 'Заявка не найдена' });
        if (app.status !== 'В списке ожидания' && app.status !== 'На рассмотрении') {
            return res.json({ success: false, error: 'Заявка не в очереди ожидания' });
        }
        db.run(`UPDATE applications SET status = 'Подтверждено' WHERE id = ?`, [applicationId], function(err) {
            if (err) return res.json({ success: false, error: err.message });
            console.log(`✅ Студент #${applicationId} зачислен из очереди`);
            res.json({ success: true, message: `Студент зачислен в секцию "${app.section}"` });
        });
    });
});

// ✅ ИСПРАВЛЕНО: отклонение работает для обоих статусов
app.delete('/api/admin/waitlist/:applicationId', (req, res) => {
    const { applicationId } = req.params;
    db.run(`UPDATE applications SET status = 'Отклонено' WHERE id = ? AND status IN ('В списке ожидания', 'На рассмотрении')`, [applicationId], function(err) {
        if (err) return res.json({ success: false, error: err.message });
        if (this.changes === 0) return res.json({ success: false, error: 'Заявка не найдена или уже обработана' });
        console.log(`✅ Заявка #${applicationId} отклонена`);
        res.json({ success: true, message: 'Заявка удалена из очереди' });
    });
});

app.get('/api/analytics/occupancy', (req, res) => {
    db.all(`SELECT DISTINCT section FROM schedules ORDER BY section`, [], (err, secRows) => {
        if (err) return res.json({ success: false, error: err.message });
        const SECTIONS = (secRows || []).map(r => r.section);
        db.all(`SELECT s.section, s.id as schedule_id, s.capacity, s.day_of_week, s.time_slot, (SELECT MAX(capacity) FROM schedules s2 WHERE LOWER(s2.section) = LOWER(s.section)) as section_capacity FROM schedules s ORDER BY s.section`, [], (err, schedules) => {
            if (err) return res.json({ success: false, error: err.message });
            const sectionsData = {};
            SECTIONS.forEach(sec => { sectionsData[sec] = { name: sec, totalCapacity: 0, totalEnrolled: 0, totalWaitlist: 0, slots: [], recommendation: 'maintain', reason: '' }; });

            let processed = 0;
            (schedules || []).forEach(slot => {
                db.get(`SELECT COUNT(DISTINCT phone) as count FROM applications WHERE section = ? AND status IN ('Подтверждено', 'Завершено')`, [slot.section], (err, row) => {
                    const enrolled = row ? row.count : 0;
                    // ✅ Считаем оба статуса очереди
                    db.get(`SELECT COUNT(DISTINCT phone) as count FROM applications WHERE section = ? AND status IN ('В списке ожидания', 'На рассмотрении')`, [slot.section], (err, row2) => {
                        const waitlist = row2 ? row2.count : 0;
                        const occupancy = slot.capacity > 0 ? Math.round((enrolled / slot.capacity) * 100) : 0;
                        const sec = sectionsData[slot.section];
                        if (sec) {
                            if (!sec._capacityCounted) { sec.totalCapacity = slot.section_capacity || slot.capacity; sec._capacityCounted = true; }
                            sec.totalEnrolled += enrolled;
                            sec.totalWaitlist += waitlist;
                            sec.slots.push({ dayTime: `${slot.day_of_week} ${slot.time_slot}`, capacity: slot.capacity, enrolled, waitlist, occupancy });
                        }
                        processed++;
                        if (processed === (schedules || []).length) finalizeAnalytics();
                    });
                });
            });
            if ((schedules || []).length === 0) finalizeAnalytics();

            function finalizeAnalytics() {
                Object.values(sectionsData).forEach(sec => {
                    if (sec.totalCapacity === 0) { sec.recommendation = 'no_data'; sec.reason = 'Нет расписания'; sec.overallOccupancy = 0; return; }
                    sec.overallOccupancy = Math.round((sec.totalEnrolled / sec.totalCapacity) * 100);
                    if (sec.totalWaitlist >= 3 && sec.overallOccupancy >= 90) { sec.recommendation = 'expand'; sec.reason = `Высокий спрос: ${sec.totalWaitlist} в очереди, заполнено ${sec.overallOccupancy}%`; }
                    else if (sec.overallOccupancy < 50 && sec.totalWaitlist === 0) { sec.recommendation = 'reduce'; sec.reason = `Низкий спрос: заполнено только ${sec.overallOccupancy}%`; }
                    else if (sec.overallOccupancy >= 85) { sec.recommendation = 'maintain'; sec.reason = `Оптимальная загрузка: ${sec.overallOccupancy}%`; }
                    else { sec.recommendation = 'monitor'; sec.reason = `Заполнено ${sec.overallOccupancy}%, требуется мониторинг`; }
                });

                const sectionsWithCapacity = Object.values(sectionsData).filter(s => s.totalCapacity > 0);
                const summary = {
                    totalSections: SECTIONS.length,
                    needExpansion: Object.values(sectionsData).filter(s => s.recommendation === 'expand').length,
                    canReduce: Object.values(sectionsData).filter(s => s.recommendation === 'reduce').length,
                    avgOccupancy: sectionsWithCapacity.length > 0 ? Math.round(sectionsWithCapacity.reduce((sum, s) => sum + s.overallOccupancy, 0) / sectionsWithCapacity.length) : 0
                };
                res.json({ success: true, summary, sections: Object.values(sectionsData) });
            }
        });
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-fixed.html')));
app.get('/student', (req, res) => res.sendFile(path.join(__dirname, 'public', 'student-cabinet.html')));
app.use((req, res) => res.status(404).json({ success: false, error: 'Не найдено' }));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n СЕРВЕР ЗАПУЩЕН: http://localhost:${PORT}\n`);
});
