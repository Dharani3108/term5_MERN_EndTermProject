// Minimal declarative input validation. Collects every field error so the
// client can show them all at once, then throws a single 400.
import { AppError } from './errors.js';

const isBlank = (v) => v === undefined || v === null || v === '';

export class Validator {
  constructor(input) {
    this.input = input && typeof input === 'object' ? input : {};
    this.errors = {};
    this.out = {};
  }

  fail(field, message) {
    if (!this.errors[field]) this.errors[field] = message;
    return this;
  }

  string(field, { required = true, min = 0, max = 1000, pattern, patternMsg, def } = {}) {
    let v = this.input[field];
    if (isBlank(v)) {
      if (required) return this.fail(field, 'is required');
      this.out[field] = def;
      return this;
    }
    if (typeof v !== 'string') return this.fail(field, 'must be text');
    v = v.trim();
    if (!v) {
      if (required) return this.fail(field, 'is required');
      this.out[field] = def;
      return this;
    }
    if (v.length < min) return this.fail(field, `must be at least ${min} characters`);
    if (v.length > max) return this.fail(field, `must be at most ${max} characters`);
    if (pattern && !pattern.test(v)) return this.fail(field, patternMsg || 'is invalid');
    this.out[field] = v;
    return this;
  }

  email(field) {
    this.string(field, {
      max: 254,
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
      patternMsg: 'must be a valid email address',
    });
    if (typeof this.out[field] === 'string') this.out[field] = this.out[field].toLowerCase();
    return this;
  }

  int(field, { required = true, min = -Infinity, max = Infinity, def } = {}) {
    const v = this.input[field];
    if (isBlank(v)) {
      if (required) return this.fail(field, 'is required');
      this.out[field] = def;
      return this;
    }
    const n = typeof v === 'string' ? Number(v) : v;
    if (!Number.isInteger(n)) return this.fail(field, 'must be a whole number');
    if (n < min) return this.fail(field, `must be at least ${min}`);
    if (n > max) return this.fail(field, `must be at most ${max}`);
    this.out[field] = n;
    return this;
  }

  oneOf(field, values, { required = true, def } = {}) {
    const v = this.input[field];
    if (isBlank(v)) {
      if (required) return this.fail(field, 'is required');
      this.out[field] = def;
      return this;
    }
    if (!values.includes(v)) return this.fail(field, `must be one of: ${values.join(', ')}`);
    this.out[field] = v;
    return this;
  }

  instant(field, { required = true } = {}) {
    const v = this.input[field];
    if (isBlank(v)) {
      if (required) return this.fail(field, 'is required');
      return this;
    }
    const ms = typeof v === 'string' ? Date.parse(v) : NaN;
    if (Number.isNaN(ms)) return this.fail(field, 'must be a valid ISO date-time');
    this.out[field] = ms;
    return this;
  }

  bool(field, { def } = {}) {
    const v = this.input[field];
    if (isBlank(v)) {
      this.out[field] = def;
      return this;
    }
    if (v === true || v === 'true' || v === '1') this.out[field] = true;
    else if (v === false || v === 'false' || v === '0') this.out[field] = false;
    else return this.fail(field, 'must be true or false');
    return this;
  }

  stringArray(field, { maxItems = 10, maxLength = 40, def = [] } = {}) {
    const v = this.input[field];
    if (isBlank(v)) {
      this.out[field] = def;
      return this;
    }
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      return this.fail(field, 'must be a list of text values');
    }
    const items = [...new Set(v.map((x) => x.trim()).filter(Boolean))];
    if (items.length > maxItems) return this.fail(field, `can have at most ${maxItems} items`);
    if (items.some((x) => x.length > maxLength)) {
      return this.fail(field, `items must be at most ${maxLength} characters`);
    }
    this.out[field] = items;
    return this;
  }

  done() {
    if (Object.keys(this.errors).length) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', this.errors);
    }
    return this.out;
  }
}

export const validate = (input) => new Validator(input);
