import { Types } from 'mongoose';
import { REGEX_PATTERNS, ERROR_CODES, SOCKET_EVENTS } from './constants';

export class ValidationHelpers {
  // Validate MongoDB ObjectId
  static isValidObjectId(id: string): boolean {
    return Types.ObjectId.isValid(id);
  }

  // Validate email format
  static isValidEmail(email: string): boolean {
    return REGEX_PATTERNS.EMAIL.test(email);
  }

  // Validate phone number
  static isValidPhoneNumber(phoneNumber: string): boolean {
    return REGEX_PATTERNS.PHONE_NUMBER.test(phoneNumber);
  }

  // Validate username
  static isValidUsername(username: string): boolean {
    return REGEX_PATTERNS.USERNAME.test(username);
  }

  // Validate password strength
  static isValidPassword(password: string): boolean {
    return REGEX_PATTERNS.PASSWORD.test(password);
  }

  // Validate OTP format
  static isValidOTP(otp: string): boolean {
    return REGEX_PATTERNS.OTP.test(otp);
  }

  // Validate hex color
  static isValidHexColor(color: string): boolean {
    return REGEX_PATTERNS.HEX_COLOR.test(color);
  }

  // Validate URL
  static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  // Validate JSON string
  static isValidJSON(str: string): boolean {
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  }

  // Validate JWT token format
  static isValidJWTFormat(token: string): boolean {
    const parts = token.split('.');
    return parts.length === 3;
  }
}

export class StringHelpers {
  // Generate random string
  static generateRandomString(length: number, includeSymbols: boolean = false): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const characterSet = includeSymbols ? chars + symbols : chars;
    
    let result = '';
    for (let i = 0; i < length; i++) {
      result += characterSet.charAt(Math.floor(Math.random() * characterSet.length));
    }
    return result;
  }

  // Generate slug from text
  static generateSlug(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
  }

  // Clean filename for safe storage
  static sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  // Escape regex special characters
  static escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Remove HTML tags
  static stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '');
  }

  // Convert string to camelCase
  static toCamelCase(str: string): string {
    return str
      .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => 
        index === 0 ? word.toLowerCase() : word.toUpperCase()
      )
      .replace(/\s+/g, '');
  }

  // Convert string to kebab-case
  static toKebabCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
  }

  // Convert string to snake_case
  static toSnakeCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[\s-]+/g, '_')
      .toLowerCase();
  }

  // Mask sensitive data
  static maskString(str: string, visibleChars: number = 4, maskChar: string = '*'): string {
    if (str.length <= visibleChars * 2) {
      return maskChar.repeat(str.length);
    }
    
    const start = str.substring(0, visibleChars);
    const end = str.substring(str.length - visibleChars);
    const middle = maskChar.repeat(str.length - visibleChars * 2);
    
    return start + middle + end;
  }

  // Extract initials from name
  static getInitials(name: string, maxLength: number = 2): string {
    return name
      .split(' ')
      .map(word => word.charAt(0).toUpperCase())
      .slice(0, maxLength)
      .join('');
  }
}

export class ArrayHelpers {
  // Remove duplicates from array
  static removeDuplicates<T>(array: T[]): T[] {
    return [...new Set(array)];
  }

  // Shuffle array
  static shuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Chunk array into smaller arrays
  static chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  // Group array by key
  static groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
    return array.reduce((groups, item) => {
      const groupKey = String(item[key]);
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(item);
      return groups;
    }, {} as Record<string, T[]>);
  }

  // Find intersection of two arrays
  static intersection<T>(array1: T[], array2: T[]): T[] {
    return array1.filter(item => array2.includes(item));
  }

  // Find difference between two arrays
  static difference<T>(array1: T[], array2: T[]): T[] {
    return array1.filter(item => !array2.includes(item));
  }

  // Sort array by multiple criteria
  static sortBy<T>(array: T[], ...criteria: ((item: T) => any)[]): T[] {
    return [...array].sort((a, b) => {
      for (const criterion of criteria) {
        const aVal = criterion(a);
        const bVal = criterion(b);
        if (aVal < bVal) return -1;
        if (aVal > bVal) return 1;
      }
      return 0;
    });
  }

  // Get unique values by property
  static uniqueBy<T>(array: T[], key: keyof T): T[] {
    const seen = new Set();
    return array.filter(item => {
      const value = item[key];
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }
}

export class ObjectHelpers {
  // Deep clone object
  static deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime()) as T;
    if (obj instanceof Array) return obj.map(item => this.deepClone(item)) as T;
    
    const cloned = {} as T;
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this.deepClone(obj[key]);
      }
    }
    return cloned;
  }

  // Deep merge objects
  static deepMerge<T extends Record<string, any>>(target: T, ...sources: Partial<T>[]): T {
    if (!sources.length) return target;
    const source = sources.shift();

    if (this.isObject(target) && this.isObject(source)) {
      for (const key in source) {
        if (this.isObject(source[key])) {
          if (!target[key]) Object.assign(target, { [key]: {} });
          if (source[key] !== undefined) {
            this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(target, { [key]: source[key] });
        }
      }
    }

    return this.deepMerge(target, ...sources);
  }

  // Check if value is object
  static isObject(item: any): boolean {
    return item && typeof item === 'object' && !Array.isArray(item);
  }

  // Pick specific keys from object
  static pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
    const result = {} as Pick<T, K>;
    keys.forEach(key => {
      if (key in obj) {
        result[key] = obj[key];
      }
    });
    return result;
  }

  // Omit specific keys from object
  static omit<T, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
    const result = { ...obj } as Omit<T, K>;
    keys.forEach(key => {
      delete (result as any)[key];
    });
    return result;
  }

  // Get nested property value safely
  static get<T>(obj: any, path: string, defaultValue?: T): T {
    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
      if (current === null || current === undefined || !(key in current)) {
        return defaultValue as T;
      }
      current = current[key];
    }

    return current as T;
  }

  // Set nested property value
  static set(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }

    current[keys[keys.length - 1]] = value;
  }

  // Check if object has nested property
  static has(obj: any, path: string): boolean {
    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
      if (current === null || current === undefined || !(key in current)) {
        return false;
      }
      current = current[key];
    }

    return true;
  }

  // Remove empty values from object
  static removeEmpty<T extends Record<string, any>>(obj: T): Partial<T> {
    const result: Partial<T> = {};
    
    for (const key in obj) {
      const value = obj[key];
      if (value !== null && value !== undefined && value !== '' && 
          !(Array.isArray(value) && value.length === 0) &&
          !(this.isObject(value) && Object.keys(value).length === 0)) {
        result[key] = value;
      }
    }
    
    return result;
  }
}

export class DateHelpers {
  // Get date range for analytics
  static getDateRange(period: 'today' | 'week' | 'month' | 'year'): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date();
    const end = new Date();

    switch (period) {
      case 'today':
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'week':
        const dayOfWeek = now.getDay();
        start.setDate(now.getDate() - dayOfWeek);
        start.setHours(0, 0, 0, 0);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        break;
      case 'month':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        end.setMonth(start.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'year':
        start.setMonth(0, 1);
        start.setHours(0, 0, 0, 0);
        end.setMonth(11, 31);
        end.setHours(23, 59, 59, 999);
        break;
    }

    return { start, end };
  }

  // Check if date is within range
  static isDateInRange(date: Date, start: Date, end: Date): boolean {
    return date >= start && date <= end;
  }

  // Add time to date
  static addTime(date: Date, amount: number, unit: 'minutes' | 'hours' | 'days' | 'weeks' | 'months'): Date {
    const result = new Date(date);
    
    switch (unit) {
      case 'minutes':
        result.setMinutes(result.getMinutes() + amount);
        break;
      case 'hours':
        result.setHours(result.getHours() + amount);
        break;
      case 'days':
        result.setDate(result.getDate() + amount);
        break;
      case 'weeks':
        result.setDate(result.getDate() + (amount * 7));
        break;
      case 'months':
        result.setMonth(result.getMonth() + amount);
        break;
    }
    
    return result;
  }

  // Get timezone offset
  static getTimezoneOffset(): number {
    return new Date().getTimezoneOffset();
  }

  // Convert to UTC
  static toUTC(date: Date): Date {
    return new Date(date.getTime() + (date.getTimezoneOffset() * 60000));
  }

  // Convert from UTC
  static fromUTC(date: Date): Date {
    return new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  }
}

export class UrlHelpers {
  // Build URL with parameters
  static buildUrl(baseUrl: string, params: Record<string, any>): string {
    const url = new URL(baseUrl);
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
    
    return url.toString();
  }

  // Parse URL parameters
  static parseUrlParams(url: string): Record<string, string> {
    const params: Record<string, string> = {};
    const urlObj = new URL(url);
    
    urlObj.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    
    return params;
  }

  // Get domain from URL
  static getDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  // Check if URL is secure (HTTPS)
  static isSecureUrl(url: string): boolean {
    try {
      return new URL(url).protocol === 'https:';
    } catch {
      return false;
    }
  }
}

export class ErrorHelpers {
  // Create standardized error object
  static createError(code: string, message: string, details?: any): {
    code: string;
    message: string;
    details?: any;
    timestamp: Date;
  } {
    return {
      code,
      message,
      details,
      timestamp: new Date()
    };
  }

  // Check if error is operational (expected)
  static isOperationalError(error: any): boolean {
    return error.isOperational === true;
  }

  // Format error for logging
  static formatErrorForLogging(error: any): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}\n${error.stack}`;
    }
    
    return JSON.stringify(error, null, 2);
  }

  // Sanitize error for client response
  static sanitizeErrorForClient(error: any, isDevelopment: boolean = false): {
    code: string;
    message: string;
    details?: any;
  } {
    // In production, don't expose internal errors
    if (!isDevelopment && !this.isOperationalError(error)) {
      return {
        code: ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: 'An internal server error occurred'
      };
    }

    return {
      code: error.code || ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: error.message || 'An error occurred',
      details: isDevelopment ? error.details : undefined
    };
  }
}
