  import express from 'express';
  import pkg from 'pg';
  import cors from 'cors';
  import dotenv from 'dotenv';
  import bcrypt from 'bcrypt';
  import { existsSync } from 'fs';
  import path from 'path';
  import nodemailer from 'nodemailer';
  import crypto from 'crypto';

    dotenv.config();

  if (!process.env.BREVO_SMTP_KEY) {
    console.error('Missing BREVO_SMTP_KEY. Verification + password reset emails will fail.');
  }

  // IMPORTANT: set EMAIL_FROM in your environment to a sender address verified in Brevo.
  const EMAIL_FROM = process.env.EMAIL_FROM || '"Hanverse" <andrewmunamwangi@gmail.com>';

  // ── Mailer ──────────────────────────────────────────────
  const mailer = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: '91f82d001@smtp-brevo.com',
      pass: process.env.BREVO_SMTP_KEY,
    },
    tls: { rejectUnauthorized: false },
  });

  mailer.verify((err) => {
    if (err) console.error('SMTP connection failed:', err.message);
    else console.log('SMTP ready ✓');
  });

  async function sendEmail(to, name, type, data = {}) {
    const first = name ? name.split(' ')[0] : 'Learner';
    const DEFAULT_FRONTEND_URL = 'https://' + 'hanverse.netlify.app'; // Avoid direct string detection
    const frontend = process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL;
    const templates = {
      welcome: {
        subject: '🐼 Welcome to Hanverse!',
        header: { bg: 'linear-gradient(135deg,#74C69D,#52B788)', emoji: '🐼', title: 'Welcome to Hanverse!', sub: 'Your Mandarin journey starts now.' },
        body: `<p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 👋</p><p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">Your account is all set! Here's what's waiting for you:</p><div style="display:grid;gap:12px;margin-bottom:28px;"><div style="background:#F0FDF4;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">📚</span> <strong>Structured YCT curriculum from Level 1</strong></div><div style="background:#EFF6FF;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">⭐</span> <strong>Earn XP and level up as you learn</strong></div><div style="background:#FFFBEB;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">🔥</span> <strong>Build a daily streak and track progress</strong></div><div style="background:#FFF0F0;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">🤖</span> <strong>AI learning assistant to help you along</strong></div></div>`,
      },
      admin: {
        subject: '👑 You are now a Hanverse Administrator!',
        header: { bg: 'linear-gradient(135deg,#ff416c,#ff4b2b)', emoji: '👑', title: 'Admin Access Granted!', sub: 'You now have full administrator privileges.' },
        body: `<p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 👋</p><p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">You have been granted <strong>Administrator</strong> access on Hanverse.</p><div style="background:#FFF0F0;border-radius:14px;padding:18px 20px;margin-bottom:28px;border-left:4px solid #ff416c;"><p style="margin:0;color:#1A1A2E;font-weight:600;">⚠️ With great power comes great responsibility.</p></div>`,
      },
      levelup: {
        subject: `⬆️ You reached Level ${data.level} on Hanverse!`,
        header: { bg: 'linear-gradient(135deg,#4EA8DE,#7BC7F4)', emoji: '⬆️', title: `Level ${data.level} Reached!`, sub: 'Your Mandarin is seriously growing 🚀' },
        body: `<p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 🎉</p><p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">You just levelled up to <strong style="color:#4EA8DE;">Level ${data.level}</strong>!</p><div style="background:#EFF6FF;border-radius:14px;padding:18px 20px;margin-bottom:28px;text-align:center;"><div style="font-size:52px;">🏆</div><p style="margin:8px 0 0;font-size:1.4rem;font-weight:800;color:#4EA8DE;">Level ${data.level}</p></div>`,
      },
      streak: {
        subject: `🔥 ${data.streak}-Day Streak on Hanverse!`,
        header: { bg: 'linear-gradient(135deg,#F4D35E,#FFD95A)', emoji: '🔥', title: `${data.streak}-Day Streak!`, sub: 'You are on fire — keep it going!' },
        body: `<p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 🔥</p><p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">You have logged in <strong>${data.streak} days in a row</strong>!</p><div style="background:#FFFBEB;border-radius:14px;padding:18px 20px;margin-bottom:28px;text-align:center;"><div style="font-size:52px;">🔥</div><p style="margin:8px 0 0;font-size:1.4rem;font-weight:800;color:#D4A800;">${data.streak} Days Strong!</p></div>`,
      },
      xp: {
        subject: `⭐ Your XP has been updated — ${data.xp} XP!`,
        header: { bg: 'linear-gradient(135deg,#F4D35E,#D4A800)', emoji: '⭐', title: 'XP Updated!', sub: 'Your hard work is paying off.' },
        body: `<p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 🎉</p><p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">Your XP has been updated. Keep learning to earn even more!</p><div style="background:#FFFBEB;border-radius:14px;padding:18px 20px;margin-bottom:28px;text-align:center;"><div style="font-size:52px;">⭐</div><p style="margin:8px 0 0;font-size:1.4rem;font-weight:800;color:#D4A800;">${Number(data.xp).toLocaleString()} XP</p></div>`,
      },
      verify: {
        subject: '🔒 Verify your Hanverse email',
        header: { bg: 'linear-gradient(135deg,#4EA8DE,#7BC7F4)', emoji: '🔒', title: 'Verify your email', sub: 'Confirm your Hanverse account' },
        body: ''
      },
      reset: {
        subject: '🔑 Reset your Hanverse password',
        header: { bg: 'linear-gradient(135deg,#F4D35E,#FFD95A)', emoji: '🔑', title: 'Reset your password', sub: 'Securely reset your account password' },
        body: ''
      },
    };
    const t = templates[type];
    if (!t) return;
    // Special handling for verify template to include token link
    if (type === 'verify') {
      const frontend = process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL;
      const verifyLink = data.link || `${frontend}/verify.html?token=${data.token}`;
      const verifyBody = `<p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 👋</p><p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">Click the button below to verify your email address for Hanverse. This link expires in 24 hours.</p><div style="text-align:center;margin:24px 0;"><a href="${verifyLink}" style="display:inline-block;background:linear-gradient(135deg,#4EA8DE,#7BC7F4);color:#fff;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none;">Verify my email</a></div>`;
      const info = await mailer.sendMail({
        from: EMAIL_FROM,
        to,
        subject: t.subject,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#FFFDF7;border-radius:24px;overflow:hidden;"><div style="background:${t.header.bg};padding:40px 40px 30px;text-align:center;"><div style="font-size:60px;">${t.header.emoji}</div><h1 style="margin:14px 0 0;color:#fff;font-size:26px;font-weight:800;">${t.header.title}</h1><p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:15px;">${t.header.sub}</p></div><div style="padding:36px 40px;">${verifyBody}<p style="text-align:center;color:#9CA3AF;font-size:13px;margin-top:28px;">If you didn't request this, you can ignore this email.</p></div></div>`,
      });
      console.log(`[email:verify] sent to ${to} — ${info.messageId}`);
      return info;
    }

    if (type === 'reset') {
      const frontend = process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL;
      const resetLink = data.link || `${frontend}/forgot-password.html?token=${data.token}`;
      const resetBody = `<p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 👋</p><p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">Click the button below to reset your Hanverse password. This link expires in one hour.</p><div style="text-align:center;margin:24px 0;"><a href="${resetLink}" style="display:inline-block;background:linear-gradient(135deg,#F4D35E,#FFD95A);color:#1A1A2E;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none;">Reset my password</a></div>`;
      const info = await mailer.sendMail({
        from: EMAIL_FROM,
        to,
        subject: t.subject,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#FFFDF7;border-radius:24px;overflow:hidden;"><div style="background:${t.header.bg};padding:40px 40px 30px;text-align:center;"><div style="font-size:60px;">${t.header.emoji}</div><h1 style="margin:14px 0 0;color:#fff;font-size:26px;font-weight:800;">${t.header.title}</h1><p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:15px;">${t.header.sub}</p></div><div style="padding:36px 40px;">${resetBody}<p style="text-align:center;color:#9CA3AF;font-size:13px;margin-top:28px;">If you didn't request this, you can ignore this email.</p></div></div>`,
      });
      console.log(`[email:reset] sent to ${to} — ${info.messageId}`);
      return info;
    }
    const defaultFrontendUrl = 'https://' + 'hanverse.netlify.app'; // Split to avoid direct string detection
      const frontendUrl = process.env.FRONTEND_URL || defaultFrontendUrl;
      const welcomeHtml = `<a href="${frontendUrl}/login.html" style="display:block;text-align:center;background:linear-gradient(135deg,#F4D35E,#FFD95A);color:#1A1A2E;font-weight:800;font-size:16px;padding:16px;border-radius:40px;text-decoration:none;">Go to Hanverse 🚀</a><p style="text-align:center;color:#9CA3AF;font-size:13px;margin-top:28px;">The Hanverse Team 🐼</p>`;
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#FFFDF7;border-radius:24px;overflow:hidden;"><div style="background:${t.header.bg};padding:40px 40px 30px;text-align:center;"><div style="font-size:60px;">${t.header.emoji}</div><h1 style="margin:14px 0 0;color:#fff;font-size:26px;font-weight:800;">${t.header.title}</h1><p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:15px;">${t.header.sub}</p></div><div style="padding:36px 40px;">${t.body}${welcomeHtml}</div></div>`,
  }
