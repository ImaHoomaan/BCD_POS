'use strict';

// Typed errors. Every error carries an HTTP status and a stable machine code so the
// UI can show a specific message and tests can assert on the exact rule that failed.

class PosError extends Error {
  constructor(message, { status = 500, code = 'error', detail = undefined } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, detail: this.detail } };
  }
}

class ValidationError extends PosError {
  // fields: { fieldName: 'message' }
  constructor(fields, message) {
    const values = Object.values(fields);
    // A single problem is reported in plain words; several are summarized.
    super(message || (values.length === 1 ? values[0] : 'Please correct the highlighted fields.'), {
      status: 422,
      code: 'validation',
      detail: { fields },
    });
    this.fields = fields;
  }
}

class Unauthenticated extends PosError {
  constructor(message = 'Please sign in.', code = 'unauthenticated') {
    super(message, { status: 401, code });
  }
}

class PermissionDenied extends PosError {
  constructor(message = 'Access denied: insufficient permission.') {
    super(message, { status: 403, code: 'forbidden' });
  }
}

class NotFound extends PosError {
  constructor(message = 'Not found.') {
    super(message, { status: 404, code: 'not_found' });
  }
}

class Conflict extends PosError {
  constructor(code, message, detail) {
    super(message, { status: 409, code, detail });
  }
}

class InsufficientStock extends PosError {
  constructor(dishNames) {
    super(`Not enough ingredients for: ${dishNames.join(', ')}.`, {
      status: 409,
      code: 'insufficient_stock',
      detail: { dishNames },
    });
    this.dishNames = dishNames;
  }
}

class AuthFailed extends PosError {
  constructor() {
    // One generic message for wrong username OR wrong password (Req 3.5).
    super('Invalid username or password.', { status: 401, code: 'auth_failed' });
  }
}

class LoginLocked extends PosError {
  constructor(until) {
    super('Login is temporarily locked. Please try again in a few minutes.', {
      status: 429,
      code: 'login_locked',
      detail: { until },
    });
    this.until = until;
  }
}

class LoginUnavailable extends PosError {
  constructor() {
    super('Login is temporarily unavailable.', { status: 503, code: 'login_unavailable' });
  }
}

class StorageError extends PosError {
  constructor(message = 'The operation failed and no data was changed.', cause) {
    super(message, { status: 500, code: 'storage' });
    this.cause = cause;
  }
}

class DatabaseStartupError extends PosError {
  constructor(path, reason) {
    super(`Cannot open database at ${path}: ${reason}`, { status: 500, code: 'db_startup', detail: { path, reason } });
    this.path = path;
    this.reason = reason;
  }
}

module.exports = {
  PosError,
  ValidationError,
  Unauthenticated,
  PermissionDenied,
  NotFound,
  Conflict,
  InsufficientStock,
  AuthFailed,
  LoginLocked,
  LoginUnavailable,
  StorageError,
  DatabaseStartupError,
};
