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
        if (err) console.error('❌ Ошибка создания applications:', err.message);
        else console.log('✅ Таблица applications создана/проверена');
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

    // Создаём таблицу schedules (расписание тренеров)
    db.run(`CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section TEXT NOT NULL,
        trainer_name TEXT NOT NULL,
        day_of_week TEXT NOT NULL,
        time_slot TEXT NOT NULL,
        capacity INTEGER DEFAULT 25,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, function(err) {
        if (err) console.error('❌ Ошибка создания schedules:', err.message);
        else {
            console.log('✅ Таблица schedules создана/проверена');
            // Заполняем тестовыми данными если пуста
            db.get('SELECT COUNT(*) as cnt FROM schedules', (err, row) => {
                if (row && row.cnt === 0) {
                    const testSchedules = [
                        ['Баскетбол', 'Иван Петров', 'Пн', '10:00', 25],
                        ['Баскетбол', 'Иван Петров', 'Ср', '15:30', 25],
                        ['Волейбол', 'Мария Сидорова', 'Вт', '16:00', 20],
                        ['волейбол', 'Мария Сидорова', 'Чт', '17:00', 20],
                        ['Футбол', 'Петр Иванов', 'Пн', '18:00', 30],
                        ['Футбол', 'Петр Иванов', 'Пт', '19:00', 30],
                        ['Плавание', 'Елена Краснова', 'Ср', '09:00', 15],
                        ['Плавание', 'Елена Краснова', 'Сб', '10:00', 15],
                        ['Теннис', 'Сергей Волков', 'Пт', '14:00', 12],
                        ['Теннис', 'Сергей Волков', 'Вс', '15:00', 12]
                    ];

                    testSchedules.forEach(schedule => {
                        db.run(
                            `INSERT INTO schedules (section, trainer_name, day_of_week, time_slot, capacity)
                             VALUES (?, ?, ?, ?, ?)`,
                            schedule,
                            (err) => {
                                if (err) console.error('Ошибка добавления расписания:', err.message);
                            }
                        );
                    });
                    console.log('📅 Тестовое расписание добавлено');
                }
            });
        }
    });

    // Создаём таблицу enrollments (зачисления)
    db.run(`CREATE TABLE IF NOT EXISTS enrollments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL UNIQUE,
        schedule_id INTEGER NOT NULL,
        status TEXT DEFAULT 'active',
        enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(application_id) REFERENCES applications(id),
        FOREIGN KEY(schedule_id) REFERENCES schedules(id)
    )`, function(err) {
        if (err) console.error('❌ Ошибка создания enrollments:', err.message);
        else console.log('✅ Таблица enrollments создана/проверена');
    });

    // Создаём таблицу waitlist (список ожидания)
    db.run(`CREATE TABLE IF NOT EXISTS waitlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL UNIQUE,
        schedule_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'waiting',
        FOREIGN KEY(application_id) REFERENCES applications(id),
        FOREIGN KEY(schedule_id) REFERENCES schedules(id)
    )`, function(err) {
        if (err) console.error('❌ Ошибка создания waitlist:', err.message);
        else console.log('✅ Таблица waitlist создана/проверена');
    });
}

// ========== АЛГОРИТМ РАСПРЕДЕЛЕНИЯ ==========

/**
 * Распределяет студента на секцию с оптимизацией заполняемости
 */
function autoAssignStudent(applicationId, section, callback) {
    // Проверяем что заявка существует
    db.get('SELECT id, status FROM applications WHERE id = ?', [applicationId], (err, app) => {
        if (err || !app) {
            return callback({ success: false, error: 'Заявка не найдена' });
        }

        // Ищем свободное расписание
        db.get(`SELECT s.id, s.capacity,
                (SELECT COUNT(*) FROM enrollments e WHERE e.schedule_id = s.id AND e.status = 'active') as enrolled
            FROM schedules s
            WHERE LOWER(s.section) = LOWER(?)
            ORDER BY enrolled ASC
            LIMIT 1`, [section], (err, schedule) => {
            
            if (err) return callback({ success: false, error: err.message });
            if (!schedule) return callback({ success: false, error: 'Расписание для этой секции не найдено' });

            const availableSlots = schedule.capacity - (schedule.enrolled || 0);

            if (availableSlots > 0) {
                // Место есть - зачисляем напрямую
                db.run(`INSERT INTO enrollments (application_id, schedule_id, status)
                        VALUES (?, ?, 'active')`, [applicationId, schedule.id], function(err) {
                    if (err) {
                        if (err.message.includes('UNIQUE')) {
                            return callback({ success: false, error: 'Студент уже записан' });
                        }
                        return callback({ success: false, error: err.message });
                    }
                    db.run('UPDATE applications SET status = ? WHERE id = ?', 
                        ['Подтверждено', applicationId], () => {
                        callback({ 
                            success: true, 
                            message: 'Студент зачислен',
                            type: 'enrolled',
                            scheduleId: schedule.id 
                        });
                    });
                });
            } else {
                // Места нет - добавляем в очередь ожидания
                db.get(`SELECT COUNT(*) as count FROM waitlist WHERE schedule_id = ? AND status = 'waiting'`,
                    [schedule.id], (err, row) => {
                    const nextPosition = (row?.count || 0) + 1;
                    
                    db.run(`INSERT INTO waitlist (application_id, schedule_id, position, status)
                            VALUES (?, ?, ?, 'waiting')`, 
                        [applicationId, schedule.id, nextPosition], function(err) {
                        if (err) {
                            if (err.message.includes('UNIQUE')) {
                                return callback({ success: false, error: 'Студент уже в очереди' });
                            }
                            return callback({ success: false, error: err.message });
                        }
                        db.run('UPDATE applications SET status = ? WHERE id = ?',
                            ['В списке ожидания', applicationId], () => {
                            callback({
                                success: true,
                                message: `Добавлен в очередь ожидания (позиция ${nextPosition})`,
                                type: 'waitlisted',
                                position: nextPosition,
                                scheduleId: schedule.id
                            });
                        });
                    });
                });
            }
        });
    });
}

/**
 * Обработка отчисления студента и автоматического зачисления из очереди
 */
function processStudentRemoval(applicationId, callback) {
    db.get(`SELECT schedule_id FROM enrollments WHERE application_id = ? AND status = 'active'`,
        [applicationId], (err, enrollment) => {
        if (err || !enrollment) return callback({ success: false, error: 'Запись не найдена' });

        const scheduleId = enrollment.schedule_id;

        // Помечаем как неактивное
        db.run(`UPDATE enrollments SET status = 'removed' WHERE application_id = ?`,
            [applicationId], () => {
            
            // Ищем первого в очереди ожидания
            db.get(`SELECT id, application_id FROM waitlist 
                    WHERE schedule_id = ? AND status = 'waiting'
                    ORDER BY position ASC LIMIT 1`, [scheduleId], (err, waitingStudent) => {
                
                if (!waitingStudent) return callback({ success: true, message: 'Студент удалён' });

                // Переводим из очереди в зачисленные
                db.run(`INSERT INTO enrollments (application_id, schedule_id, status)
                        VALUES (?, ?, 'active')`, 
                    [waitingStudent.application_id, scheduleId], function(err) {
                    if (err) return callback({ success: false, error: err.message });

                    // Обновляем позиции в очереди
                    db.run(`UPDATE waitlist SET position = position - 1 
                            WHERE schedule_id = ? AND status = 'waiting' AND position > 1`,
                        [scheduleId], () => {
                        
                        // Удаляем перемещённого студента из очереди
                        db.run(`DELETE FROM waitlist WHERE id = ?`, [waitingStudent.id], () => {
                            db.run(`UPDATE applications SET status = 'Подтверждено' 
                                    WHERE id = ?`, [waitingStudent.application_id], () => {
                                callback({
                                    success: true,
                                    message: 'Студент удалён, следующий из очереди зачислен',
                                    promotedApplicationId: waitingStudent.application_id
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

// ========== API ENDPOINTS ==========

// Автоматическое распределение студента
app.post('/api/auto-assign', (req, res) => {
    const { applicationId, section } = req.body;
    if (!applicationId || !section) {
        return res.json({ success: false, error: 'Укажите applicationId и section' });
    }

    autoAssignStudent(applicationId, section, (result) => {
        res.json(result);
    });
});

// Получить статистику по залам
app.get('/api/halls/distribution', (req, res) => {
    db.all(`SELECT 
        s.id, s.section, s.trainer_name, s.day_of_week, s.time_slot, s.capacity,
        (SELECT COUNT(*) FROM enrollments e WHERE e.schedule_id = s.id AND e.status = 'active') as enrolled,
        (SELECT COUNT(*) FROM waitlist w WHERE w.schedule_id = s.id AND w.status = 'waiting') as waiting
    FROM schedules s
    ORDER BY s.section, s.day_of_week, s.time_slot`, [], (err, rows) => {
        if (err) return res.json({ success: false, error: err.message });

        const distribution = (rows || []).map(row => ({
            scheduleId: row.id,
            section: row.section,
            trainer: row.trainer_name,
            dayTime: `${row.day_of_week} ${row.time_slot}`,
            capacity: row.capacity,
            enrolled: row.enrolled,
            occupancy: Math.round((row.enrolled / row.capacity) * 100),
            available: row.capacity - row.enrolled,
            waitingCount: row.waiting,
            isFull: row.enrolled >= row.capacity
        }));

        res.json({ success: true, distribution });
    });
});

// Список ожидания для зала
app.get('/api/waitlist/:scheduleId', (req, res) => {
    const scheduleId = req.params.scheduleId;
    db.all(`SELECT 
        w.id, w.position, a.student_name, a.phone, w.added_at
    FROM waitlist w
    JOIN applications a ON w.application_id = a.id
    WHERE w.schedule_id = ? AND w.status = 'waiting'
    ORDER BY w.position ASC`, [scheduleId], (err, rows) => {
        if (err) return res.json({ success: false, error: err.message });
        res.json({ success: true, waitlist: rows || [] });
    });
});

// Удалить студента с зачисления
app.post('/api/enrollment/remove', (req, res) => {
    const { applicationId } = req.body;
    if (!applicationId) return res.json({ success: false, error: 'Укажите applicationId' });

    processStudentRemoval(applicationId, (result) => {
        res.json(result);
    });
});

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

// ========== АНАЛИТИКА ЗАПОЛНЯЕМОСТИ ==========

/**
 * Возвращает аналитику по заполняемости секций с рекомендациями
 */
app.get('/api/analytics/occupancy', (req, res) => {
    const SECTIONS = ['Баскетбол', 'Волейбол', 'Футбол', 'Плавание', 'Теннис'];
    const TARGET_OCCUPANCY = 85;
    const MIN_WAITLIST_FOR_EXPAND = 3;
    
    // Получаем расписание
    db.all(`SELECT 
        s.section, s.id as schedule_id, s.capacity, s.day_of_week, s.time_slot
    FROM schedules s`, [], (err, schedules) => {
        if (err) return res.json({ success: false, error: err.message });

        const sectionsData = {};
        SECTIONS.forEach(sec => {
            sectionsData[sec] = {
                name: sec, totalCapacity: 0, totalEnrolled: 0, totalWaitlist: 0,
                slots: [], recommendation: 'maintain', reason: ''
            };
        });

        // Для каждого слота считаем подтверждённые заявки
        const processSlot = (slot, callback) => {
            // Считаем подтверждённые заявки (статус "Подтверждено" или "Завершено")
            db.get(`SELECT COUNT(*) as count FROM applications 
                    WHERE section = ? AND status IN ('Подтверждено', 'Завершено')`, 
                    [slot.section], (err, row) => {
                const enrolled = row ? row.count : 0;
                
                // Считаем заявки в очереди (статус "В списке ожидания")
                db.get(`SELECT COUNT(*) as count FROM applications 
                        WHERE section = ? AND status = 'В списке ожидания'`, 
                        [slot.section], (err, row2) => {
                    const waitlist = row2 ? row2.count : 0;
                    
                    const occupancy = slot.capacity > 0 
                        ? Math.round((enrolled / slot.capacity) * 100) 
                        : 0;
                    
                    callback({
                        id: slot.schedule_id,
                        section: slot.section,
                        dayTime: `${slot.day_of_week} ${slot.time_slot}`,
                        capacity: slot.capacity,
                        enrolled: enrolled,
                        waitlist: waitlist,
                        occupancy: occupancy,
                        available: slot.capacity - enrolled
                    });
                });
            });
        };

        // Обрабатываем все слоты последовательно
        let processed = 0;
        (schedules || []).forEach(slot => {
            processSlot(slot, (slotData) => {
                const sec = sectionsData[slotData.section];
                if (sec) {
                    sec.totalCapacity += slotData.capacity;
                    sec.totalEnrolled += slotData.enrolled;
                    sec.totalWaitlist += slotData.waitlist;
                    sec.slots.push(slotData);
                }
                
                processed++;
                if (processed === (schedules || []).length) {
                    finalizeAnalytics();
                }
            });
        });
        
        // Если нет расписания
        if ((schedules || []).length === 0) {
            finalizeAnalytics();
        }

        function finalizeAnalytics() {
            // Рассчитываем рекомендации для каждой секции
            Object.values(sectionsData).forEach(sec => {
                if (sec.totalCapacity === 0) {
                    sec.recommendation = 'no_data';
                    sec.reason = 'Нет расписания';
                    sec.overallOccupancy = 0;
                    return;
                }
                
                sec.overallOccupancy = Math.round((sec.totalEnrolled / sec.totalCapacity) * 100);
                
                // Логика рекомендаций
                if (sec.totalWaitlist >= MIN_WAITLIST_FOR_EXPAND && sec.overallOccupancy >= 90) {
                    sec.recommendation = 'expand';
                    sec.reason = `Высокий спрос: ${sec.totalWaitlist} в очереди, заполнено ${sec.overallOccupancy}%`;
                } else if (sec.overallOccupancy < 50 && sec.totalWaitlist === 0) {
                    sec.recommendation = 'reduce';
                    sec.reason = `Низкий спрос: заполнено только ${sec.overallOccupancy}%, нет очереди`;
                } else if (sec.overallOccupancy >= TARGET_OCCUPANCY) {
                    sec.recommendation = 'maintain';
                    sec.reason = `Оптимальная загрузка: ${sec.overallOccupancy}%`;
                } else {
                    sec.recommendation = 'monitor';
                    sec.reason = `Заполнено ${sec.overallOccupancy}%, требуется мониторинг`;
                }
            });

            // Сводная статистика
            const sectionsWithCapacity = Object.values(sectionsData).filter(s => s.totalCapacity > 0);
            const summary = {
                totalSections: SECTIONS.length,
                needExpansion: Object.values(sectionsData).filter(s => s.recommendation === 'expand').length,
                canReduce: Object.values(sectionsData).filter(s => s.recommendation === 'reduce').length,
                optimal: Object.values(sectionsData).filter(s => s.recommendation === 'maintain').length,
                avgOccupancy: sectionsWithCapacity.length > 0
                    ? Math.round(sectionsWithCapacity.reduce((sum, s) => sum + s.overallOccupancy, 0) / sectionsWithCapacity.length)
                    : 0
            };

            res.json({
                success: true,
                summary,
                sections: Object.values(sectionsData),
                generatedAt: new Date().toISOString()
            });
        }
    });
});

/**
 * Экспорт аналитики в формате для отчёта
 */
app.get('/api/analytics/export', (req, res) => {
    // Можно расширить для генерации CSV/Excel
    res.json({
        success: true,
        message: 'Экспорт аналитики',
        data: 'Формат: CSV/Excel - реализуется по требованию'
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