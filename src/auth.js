const express = require('express');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

function setupAuth(userDb, appUrl) {
    const authRouter = express.Router();
    const adminRouter = express.Router();
    // --- Email transporter ---
    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT || '587'),
        secure: process.env.EMAIL_PORT === '465',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 5000,
        family: 4,
    });

    async function sendSetPasswordEmail(toEmail, token) {
        const link = `${appUrl}/set-password.html?token=${token}`;
        await transporter.sendMail({
            from: `"Tur.com Dashboard" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
            to: toEmail,
            subject: 'Configura tu acceso al Dashboard de Tur.com',
            html: `
                <div style="font-family: Inter, sans-serif; max-width: 480px; margin: 0 auto; background: #09090b; color: #fafafa; padding: 32px; border-radius: 12px;">
                    <h2 style="color: #fafafa; margin-bottom: 8px;">Bienvenido al Dashboard</h2>
                    <p style="color: #a1a1aa; margin-bottom: 24px;">Te han dado acceso al dashboard de ventas de Tur.com. Haz clic en el botón para crear tu contraseña.</p>
                    <a href="${link}" style="display: inline-block; background: #3b82f6; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Crear contraseña</a>
                    <p style="color: #52525b; font-size: 12px; margin-top: 24px;">Este enlace expira en 48 horas. Si no esperabas este email, ignóralo.</p>
                </div>
            `,
        });
    }

    // --- Middleware ---
    function requireAuth(req, res, next) {
        if (req.session && req.session.userId) return next();
        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'No autenticado' });
        }
        res.redirect('/login.html');
    }

    function requireAdmin(req, res, next) {
        if (req.session && req.session.role === 'admin') return next();
        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        res.redirect('/');
    }

    // --- Auth routes ---

    // POST /api/auth/login
    authRouter.post('/login', async (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

            const user = await userDb.getUserByEmail(email);
            if (!user || !user.password_hash) {
                return res.status(401).json({ error: 'Credenciales inválidas' });
            }

            const valid = await bcrypt.compare(password, user.password_hash);
            if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });

            req.session.userId = user.id;
            req.session.email = user.email;
            req.session.role = user.role;

            res.json({ ok: true, role: user.role });
        } catch (err) {
            console.error('Login error:', err);
            res.status(500).json({ error: 'Error del servidor' });
        }
    });

    // POST /api/auth/logout
    authRouter.post('/logout', (req, res) => {
        req.session.destroy(() => res.json({ ok: true }));
    });

    // GET /api/auth/me
    authRouter.get('/me', requireAuth, (req, res) => {
        res.json({ email: req.session.email, role: req.session.role });
    });

    // POST /api/auth/set-password
    authRouter.post('/set-password', async (req, res) => {
        try {
            const { token, password } = req.body;
            if (!token || !password) return res.status(400).json({ error: 'Token y contraseña requeridos' });
            if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

            const tokenRecord = await userDb.getValidToken(token);
            if (!tokenRecord) return res.status(400).json({ error: 'Token inválido o expirado' });

            const hash = await bcrypt.hash(password, 12);
            await userDb.setPassword(tokenRecord.user_id, hash);
            await userDb.markTokenUsed(token);

            res.json({ ok: true });
        } catch (err) {
            console.error('Set password error:', err);
            res.status(500).json({ error: 'Error del servidor' });
        }
    });

    // GET /api/auth/validate-token
    authRouter.get('/validate-token', async (req, res) => {
        const { token } = req.query;
        if (!token) return res.status(400).json({ error: 'Token requerido' });
        const record = await userDb.getValidToken(token);
        if (!record) return res.status(400).json({ error: 'Token inválido o expirado' });
        res.json({ ok: true, email: record.email });
    });

    // --- Admin routes ---

    // GET /api/admin/users
    adminRouter.get('/users', requireAuth, requireAdmin, async (req, res) => {
        try {
            const users = await userDb.getAllUsers();
            res.json(users);
        } catch (err) {
            res.status(500).json({ error: 'Error obteniendo usuarios' });
        }
    });

    // POST /api/admin/users — create user + send invite email
    adminRouter.post('/users', requireAuth, requireAdmin, async (req, res) => {
        try {
            const { email } = req.body;
            if (!email) return res.status(400).json({ error: 'Email requerido' });

            let user = await userDb.getUserByEmail(email);
            let userId;

            if (user) {
                // User exists — only allow resend if they haven't set a password yet
                if (user.password_hash) return res.status(409).json({ error: 'Este email ya tiene una cuenta activa' });
                userId = user.id;
            } else {
                userId = await userDb.createUser(email, 'viewer');
            }

            const token = await userDb.createPasswordToken(userId);
            const inviteLink = `${appUrl}/set-password.html?token=${token}`;

            let emailSent = false;
            try {
                await sendSetPasswordEmail(email, token);
                emailSent = true;
            } catch (emailErr) {
                console.error('Email send error:', emailErr.message);
            }

            res.json({
                ok: true,
                message: `Usuario creado. Copia el link y compártelo con ${email}.`,
                inviteLink,
                emailSent
            });
        } catch (err) {
            console.error('Create user error:', err);
            res.status(500).json({ error: 'Error creando usuario: ' + err.message });
        }
    });

    // DELETE /api/admin/users/:id
    adminRouter.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const user = await userDb.getUserById(id);
            if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
            if (user.role === 'admin') return res.status(403).json({ error: 'No puedes eliminar al admin' });

            await userDb.deactivateUser(id);
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: 'Error eliminando usuario' });
        }
    });

    // POST /api/admin/users/:id/resend-invite
    adminRouter.post('/users/:id/resend-invite', requireAuth, requireAdmin, async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const user = await userDb.getUserById(id);
            if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

            const token = await userDb.createPasswordToken(id);
            const inviteLink = `${appUrl}/set-password.html?token=${token}`;

            let emailSent = false;
            try {
                await sendSetPasswordEmail(user.email, token);
                emailSent = true;
            } catch (emailErr) {
                console.error('Resend invite error:', emailErr.message);
            }

            res.json({
                ok: true,
                message: `Link generado. Compártelo con ${user.email}.`,
                inviteLink,
                emailSent
            });
        } catch (err) {
            console.error('Resend invite error:', err);
            res.status(500).json({ error: 'Error reenviando invitación: ' + err.message });
        }
    });

    // GET /api/admin/test-email — verifica config SMTP
    adminRouter.get('/test-email', requireAuth, requireAdmin, async (req, res) => {
        try {
            await transporter.verify();
            res.json({ ok: true, message: 'Conexión SMTP OK' });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    return { authRouter, adminRouter, requireAuth, requireAdmin };
}

module.exports = setupAuth;
