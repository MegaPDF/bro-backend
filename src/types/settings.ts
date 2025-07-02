export interface ISettings {
  _id: string;
  category: SettingsCategory;
  key: string;
  value: any;
  type: SettingsType;
  description: string;
  isEncrypted: boolean;
  isPublic: boolean;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SettingsCategory = 'aws' | 'email' | 'coturn' | 'push_notifications' | 'general' | 'security' | 'features';
export type SettingsType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface SettingsCreateRequest {
  category: SettingsCategory;
  key: string;
  value: any;
  type: SettingsType;
  description: string;
  isEncrypted?: boolean;
  isPublic?: boolean;
}

export interface SettingsUpdateRequest {
  value: any;
  description?: string;
  isEncrypted?: boolean;
  isPublic?: boolean;
}

export interface SettingsResponse {
  setting: ISettings;
}

export interface SettingsListResponse {
  settings: SettingsResponse[];
  total: number;
  page: number;
  limit: number;
}

export interface SettingsBulkUpdateRequest {
  settings: Array<{
    key: string;
    value: any;
    category: SettingsCategory;
  }>;
}