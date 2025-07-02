import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';
import { CoturnCredentialsService } from './credentials';
import { TIME_CONSTANTS } from '@/lib/utils/constants';

export interface TurnServer {
  id: string;
  region: string;
  url: string;
  port: number;
  protocol: 'udp' | 'tcp' | 'tls';
  isActive: boolean;
  load: number; // 0-100
  maxUsers: number;
  currentUsers: number;
  lastHealthCheck: Date;
  responseTime: number; // in ms
  metadata: {
    location: string;
    provider: string;
    version: string;
    capacity: number;
  };
}

export interface ServerHealthStatus {
  serverId: string;
  isHealthy: boolean;
  responseTime: number;
  lastChecked: Date;
  errors: string[];
}

export interface RegionInfo {
  region: string;
  servers: TurnServer[];
  totalCapacity: number;
  currentLoad: number;
  averageResponseTime: number;
}

export class CoturnServersService {
  private static healthCheckInterval: NodeJS.Timeout | null = null;
  private static readonly HEALTH_CHECK_INTERVAL = 60 * 1000; // 1 minute
  private static readonly HEALTH_CHECK_TIMEOUT = 5000; // 5 seconds
  private static readonly MAX_RESPONSE_TIME = 500; // 500ms

  // Initialize server monitoring
  static async initialize(): Promise<void> {
    try {
      await this.loadServersFromConfig();
      this.startHealthMonitoring();
      console.log('COTURN servers service initialized');
    } catch (error) {
      console.error('Failed to initialize COTURN servers service:', error);
    }
  }

  // Get all available servers
  static async getAllServers(): Promise<TurnServer[]> {
    try {
      await connectDB();

      const setting = await Settings.findOne({
        category: 'coturn',
        key: 'servers'
      });

      return setting?.value || [];

    } catch (error: any) {
      console.error('Error getting servers:', error);
      return [];
    }
  }

  // Get servers by region
  static async getServersByRegion(region: string): Promise<TurnServer[]> {
    try {
      const allServers = await this.getAllServers();
      return allServers.filter(server => 
        server.region === region && 
        server.isActive
      );
    } catch (error: any) {
      console.error('Error getting servers by region:', error);
      return [];
    }
  }

  // Get optimal server for user
  static async getOptimalServer(userRegion?: string): Promise<TurnServer | null> {
    try {
      const allServers = await this.getAllServers();
      const activeServers = allServers.filter(server => server.isActive);

      if (activeServers.length === 0) {
        return null;
      }

      // If user region is specified, prefer servers in that region
      if (userRegion) {
        const regionServers = activeServers.filter(server => server.region === userRegion);
        if (regionServers.length > 0) {
          return this.selectBestServer(regionServers);
        }
      }

      // Fallback to best available server globally
      return this.selectBestServer(activeServers);

    } catch (error: any) {
      console.error('Error getting optimal server:', error);
      return null;
    }
  }

  // Add new server
  static async addServer(serverConfig: Omit<TurnServer, 'id' | 'load' | 'currentUsers' | 'lastHealthCheck'>): Promise<TurnServer> {
    try {
      await connectDB();

      const newServer: TurnServer = {
        ...serverConfig,
        id: this.generateServerId(),
        load: 0,
        currentUsers: 0,
        lastHealthCheck: new Date()
      };

      const allServers = await this.getAllServers();
      const updatedServers = [...allServers, newServer];

      await this.updateServersConfig(updatedServers);

      return newServer;

    } catch (error: any) {
      throw new Error(`Failed to add server: ${error.message}`);
    }
  }

  // Update server
  static async updateServer(serverId: string, updates: Partial<TurnServer>): Promise<TurnServer | null> {
    try {
      await connectDB();

      const allServers = await this.getAllServers();
      const serverIndex = allServers.findIndex(server => server.id === serverId);

      if (serverIndex === -1) {
        return null;
      }

      const updatedServer = { ...allServers[serverIndex], ...updates };
      allServers[serverIndex] = updatedServer;

      await this.updateServersConfig(allServers);

      return updatedServer;

    } catch (error: any) {
      throw new Error(`Failed to update server: ${error.message}`);
    }
  }

  // Remove server
  static async removeServer(serverId: string): Promise<boolean> {
    try {
      await connectDB();

      const allServers = await this.getAllServers();
      const filteredServers = allServers.filter(server => server.id !== serverId);

      if (filteredServers.length === allServers.length) {
        return false; // Server not found
      }

      await this.updateServersConfig(filteredServers);

      return true;

    } catch (error: any) {
      console.error('Error removing server:', error);
      return false;
    }
  }

  // Perform health check on all servers
  static async performHealthCheck(): Promise<ServerHealthStatus[]> {
    try {
      const allServers = await this.getAllServers();
      const healthChecks = await Promise.allSettled(
        allServers.map(server => this.checkServerHealth(server))
      );

      const results: ServerHealthStatus[] = [];
      
      healthChecks.forEach((result, index) => {
        const server = allServers[index];
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            serverId: server.id,
            isHealthy: false,
            responseTime: 0,
            lastChecked: new Date(),
            errors: [result.reason?.message || 'Health check failed']
          });
        }
      });

      // Update server statuses
      await this.updateServerHealthStatuses(results);

      return results;

    } catch (error: any) {
      console.error('Error performing health check:', error);
      return [];
    }
  }

  // Get region information
  static async getRegionInfo(): Promise<RegionInfo[]> {
    try {
      const allServers = await this.getAllServers();
      const regions = new Map<string, TurnServer[]>();

      // Group servers by region
      allServers.forEach(server => {
        if (!regions.has(server.region)) {
          regions.set(server.region, []);
        }
        regions.get(server.region)!.push(server);
      });

      // Calculate region statistics
      const regionInfo: RegionInfo[] = [];
      regions.forEach((servers, region) => {
        const activeServers = servers.filter(server => server.isActive);
        const totalCapacity = activeServers.reduce((sum, server) => sum + server.maxUsers, 0);
        const currentLoad = activeServers.reduce((sum, server) => sum + server.currentUsers, 0);
        const averageResponseTime = activeServers.length > 0 
          ? activeServers.reduce((sum, server) => sum + server.responseTime, 0) / activeServers.length
          : 0;

        regionInfo.push({
          region,
          servers,
          totalCapacity,
          currentLoad,
          averageResponseTime
        });
      });

      return regionInfo;

    } catch (error: any) {
      console.error('Error getting region info:', error);
      return [];
    }
  }

  // Get server statistics
  static async getServerStatistics(): Promise<{
    totalServers: number;
    activeServers: number;
    totalCapacity: number;
    currentLoad: number;
    averageResponseTime: number;
    healthyServers: number;
  }> {
    try {
      const allServers = await this.getAllServers();
      const activeServers = allServers.filter(server => server.isActive);
      const healthyServers = allServers.filter(server => 
        server.isActive && server.responseTime < this.MAX_RESPONSE_TIME
      );

      return {
        totalServers: allServers.length,
        activeServers: activeServers.length,
        totalCapacity: activeServers.reduce((sum, server) => sum + server.maxUsers, 0),
        currentLoad: activeServers.reduce((sum, server) => sum + server.currentUsers, 0),
        averageResponseTime: activeServers.length > 0 
          ? activeServers.reduce((sum, server) => sum + server.responseTime, 0) / activeServers.length
          : 0,
        healthyServers: healthyServers.length
      };

    } catch (error: any) {
      console.error('Error getting server statistics:', error);
      return {
        totalServers: 0,
        activeServers: 0,
        totalCapacity: 0,
        currentLoad: 0,
        averageResponseTime: 0,
        healthyServers: 0
      };
    }
  }

  // Private helper methods
  private static selectBestServer(servers: TurnServer[]): TurnServer {
    // Sort by load (ascending) and response time (ascending)
    return servers.sort((a, b) => {
      const loadDiff = a.load - b.load;
      if (loadDiff !== 0) return loadDiff;
      return a.responseTime - b.responseTime;
    })[0];
  }

  private static async checkServerHealth(server: TurnServer): Promise<ServerHealthStatus> {
    const startTime = Date.now();
    const errors: string[] = [];

    try {
      // Implement actual health check (e.g., STUN request)
      // This is a placeholder for the actual implementation
      await this.performStunCheck(server);

      const responseTime = Date.now() - startTime;
      const isHealthy = responseTime < this.HEALTH_CHECK_TIMEOUT;

      return {
        serverId: server.id,
        isHealthy,
        responseTime,
        lastChecked: new Date(),
        errors: isHealthy ? [] : [`High response time: ${responseTime}ms`]
      };

    } catch (error: any) {
      return {
        serverId: server.id,
        isHealthy: false,
        responseTime: Date.now() - startTime,
        lastChecked: new Date(),
        errors: [error.message]
      };
    }
  }

  private static async performStunCheck(server: TurnServer): Promise<void> {
    // Placeholder for actual STUN check implementation
    // You would implement a STUN binding request here
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (Math.random() > 0.1) { // 90% success rate for simulation
          resolve();
        } else {
          reject(new Error('STUN check failed'));
        }
      }, Math.random() * 200 + 50); // 50-250ms simulated response time
    });
  }

  private static async updateServerHealthStatuses(healthStatuses: ServerHealthStatus[]): Promise<void> {
    try {
      const allServers = await this.getAllServers();
      
      healthStatuses.forEach(status => {
        const server = allServers.find(s => s.id === status.serverId);
        if (server) {
          server.isActive = status.isHealthy;
          server.responseTime = status.responseTime;
          server.lastHealthCheck = status.lastChecked;
        }
      });

      await this.updateServersConfig(allServers);

    } catch (error) {
      console.error('Error updating server health statuses:', error);
    }
  }

  private static async updateServersConfig(servers: TurnServer[]): Promise<void> {
    await connectDB();

    await Settings.findOneAndUpdate(
      { category: 'coturn', key: 'servers' },
      {
        value: servers,
        type: 'array',
        description: 'COTURN servers configuration',
        isPublic: false,
        updatedBy: 'system'
      },
      { upsert: true, new: true }
    );
  }

  private static async loadServersFromConfig(): Promise<void> {
    try {
      const envServers = process.env.COTURN_SERVERS;
      if (!envServers) return;

      const serverUrls = JSON.parse(envServers) as string[];
      const existingServers = await this.getAllServers();

      // Add servers from environment if they don't exist
      for (const url of serverUrls) {
        const exists = existingServers.some(server => server.url === url);
        if (!exists) {
          const [protocol, host] = url.split('://');
          const [hostname, port] = host.split(':');

          await this.addServer({
            region: this.guessRegionFromHostname(hostname),
            url: hostname,
            port: parseInt(port) || 3478,
            protocol: protocol.includes('tls') ? 'tls' : protocol as 'udp' | 'tcp',
            isActive: true,
            responseTime: 0,
            maxUsers: 1000,
            metadata: {
              location: 'Unknown',
              provider: 'Environment',
              version: 'Unknown',
              capacity: 1000
            }
          });
        }
      }

    } catch (error) {
      console.error('Error loading servers from config:', error);
    }
  }

  private static guessRegionFromHostname(hostname: string): string {
    const regionHints = {
      'us-east': 'us-east-1',
      'us-west': 'us-west-1',
      'eu-west': 'eu-west-1',
      'ap-south': 'ap-south-1',
      'asia': 'ap-southeast-1'
    };

    for (const [hint, region] of Object.entries(regionHints)) {
      if (hostname.includes(hint)) {
        return region;
      }
    }

    return 'global';
  }

  private static generateServerId(): string {
    return `coturn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private static startHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        console.error('Health check error:', error);
      }
    }, this.HEALTH_CHECK_INTERVAL);
  }

  static stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}