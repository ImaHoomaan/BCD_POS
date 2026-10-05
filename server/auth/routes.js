'use strict';

const express = require('express');
const { login, logout } = require('./login');
const { navFor, homePathFor } = require('./rbac');
const { COOKIE_NAME, cookieOptions } = require('../http/middleware');

// ctx: { db, clock, http: {requireSession}, newDraftJson: () => string, config }
module.exports = function authRoutes({ db, clock, http, newDraftJson, config }) {
  const r = express.Router();

  const sessionPayload = (user, csrfToken) => ({
    user: { username: user.username, role: user.role },
    csrfToken,
    nav: navFor(user.role),
    home: homePathFor(user.role),
    config,
  });

  r.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    const result = login(db, { username, password, draftJson: newDraftJson() }, clock());
    res.cookie(COOKIE_NAME, result.token, cookieOptions);
    res.json(sessionPayload(result.user, result.csrfToken));
  });

  r.get('/me', http.requireSession, (req, res) => {
    res.json(sessionPayload(req.principal, req.session.csrfToken));
  });

  r.post('/logout', (req, res) => {
    if (req.session) logout(db, req.session.token);
    res.clearCookie(COOKIE_NAME, cookieOptions);
    res.status(204).end();
  });

  // Heartbeat: the attachSession middleware already extended the idle timer.
  r.post('/activity', http.requireSession, (req, res) => res.status(204).end());

  return r;
};
