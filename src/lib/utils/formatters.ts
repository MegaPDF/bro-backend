import { TIME_CONSTANTS } from './constants';

export class DateFormatter {
  // Format date for display
  static formatDate(date: Date | string, locale: string = 'en-US'): string {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();

    // Less than 1 minute
    if (diffMs < TIME_CONSTANTS.MINUTE) {
      return 'just now';
    }

    // Less than 1 hour
    if (diffMs < TIME_CONSTANTS.HOUR) {
      const minutes = Math.floor(diffMs / TIME_CONSTANTS.MINUTE);
      return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    }

    // Same day
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    }

    // Yesterday
    const yesterday = new Date(now.getTime() - TIME_CONSTANTS.DAY);
    if (d.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }

    // This week
    if (diffMs < 7 * TIME_CONSTANTS.DAY) {
      return d.toLocaleDateString(locale, { weekday: 'long' });
    }

    // This year
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric'
      });
    }

    // Different year
    return d.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  // Format timestamp for messages
  static formatMessageTime(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  // Format last seen
  static formatLastSeen(date: Date | string): string {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();

    if (diffMs < TIME_CONSTANTS.MINUTE) {
      return 'online';
    }

    if (diffMs < TIME_CONSTANTS.HOUR) {
      const minutes = Math.floor(diffMs / TIME_CONSTANTS.MINUTE);
      return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    }

    if (diffMs < TIME_CONSTANTS.DAY) {
      const hours = Math.floor(diffMs / TIME_CONSTANTS.HOUR);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    }

    if (diffMs < TIME_CONSTANTS.WEEK) {
      const days = Math.floor(diffMs / TIME_CONSTANTS.DAY);
      return `${days} day${days > 1 ? 's' : ''} ago`;
    }

    return this.formatDate(d);
  }

  // Format duration (for calls, voice messages)
  static formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `0:${seconds.toString().padStart(2, '0')}`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes < 60) {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
}

export class NumberFormatter {
  // Format file size
  static formatFileSize(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = Math.round((bytes / Math.pow(1024, i)) * 100) / 100;
    
    return `${size} ${sizes[i]}`;
  }

  // Format large numbers (for counts, views, etc.)
  static formatCount(count: number): string {
    if (count < 1000) return count.toString();
    if (count < 1000000) return `${Math.round(count / 100) / 10}K`;
    if (count < 1000000000) return `${Math.round(count / 100000) / 10}M`;
    return `${Math.round(count / 100000000) / 10}B`;
  }

  // Format percentage
  static formatPercentage(value: number, decimals: number = 1): string {
    return `${(value * 100).toFixed(decimals)}%`;
  }
}

export class PhoneFormatter {
  // Format phone number for display
  static formatPhoneNumber(phoneNumber: string, countryCode?: string): string {
    // Remove all non-digit characters
    const cleaned = phoneNumber.replace(/\D/g, '');
    
    // Add country code if provided and not already present
    let formatted = cleaned;
    if (countryCode && !cleaned.startsWith(countryCode.replace('+', ''))) {
      formatted = countryCode.replace('+', '') + cleaned;
    }

    // Format based on length (basic formatting)
    if (formatted.length === 11 && formatted.startsWith('1')) {
      // US/Canada format: +1 (123) 456-7890
      return `+1 (${formatted.substr(1, 3)}) ${formatted.substr(4, 3)}-${formatted.substr(7, 4)}`;
    }

    if (formatted.length >= 10) {
      // International format: +XX XXX XXX XXXX
      return `+${formatted.substr(0, 2)} ${formatted.substr(2, 3)} ${formatted.substr(5, 3)} ${formatted.substr(8)}`;
    }

    return `+${formatted}`;
  }

  // Validate phone number format
  static isValidPhoneNumber(phoneNumber: string): boolean {
    const cleaned = phoneNumber.replace(/\D/g, '');
    return cleaned.length >= 10 && cleaned.length <= 15;
  }
}

export class TextFormatter {
  // Truncate text with ellipsis
  static truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  // Capitalize first letter
  static capitalize(text: string): string {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  // Convert to title case
  static titleCase(text: string): string {
    return text.replace(/\w\S*/g, (txt) =>
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  }

  // Format message preview (remove formatting, truncate)
  static formatMessagePreview(message: string, maxLength: number = 50): string {
    // Remove markdown formatting
    const cleaned = message
      .replace(/\*\*(.*?)\*\*/g, '$1') // bold
      .replace(/\*(.*?)\*/g, '$1') // italic
      .replace(/`(.*?)`/g, '$1') // code
      .replace(/~~(.*?)~~/g, '$1') // strikethrough
      .replace(/\n/g, ' ') // newlines
      .trim();

    return this.truncate(cleaned, maxLength);
  }

  // Sanitize text for display (basic HTML escaping)
  static sanitize(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  // Extract mentions from text
  static extractMentions(text: string): string[] {
    const mentionRegex = /@(\w+)/g;
    const mentions: string[] = [];
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }

    return mentions;
  }

  // Extract hashtags from text
  static extractHashtags(text: string): string[] {
    const hashtagRegex = /#(\w+)/g;
    const hashtags: string[] = [];
    let match;

    while ((match = hashtagRegex.exec(text)) !== null) {
      hashtags.push(match[1]);
    }

    return hashtags;
  }

  // Extract URLs from text
  static extractUrls(text: string): string[] {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex) || [];
  }
}

export class ColorFormatter {
  // Generate avatar color based on name/id
  static generateAvatarColor(input: string): string {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
      '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#F4D03F'
    ];

    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = input.charCodeAt(i) + ((hash << 5) - hash);
    }

    const index = Math.abs(hash) % colors.length;
    return colors[index];
  }

  // Convert hex to RGB
  static hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  // Convert RGB to hex
  static rgbToHex(r: number, g: number, b: number): string {
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  // Get contrasting text color for background
  static getContrastColor(backgroundColor: string): string {
    const rgb = this.hexToRgb(backgroundColor);
    if (!rgb) return '#000000';

    const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
    return brightness > 128 ? '#000000' : '#FFFFFF';
  }
}